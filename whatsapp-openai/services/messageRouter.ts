import { OpenAI } from 'openai';
import { MemoryStorage } from '../entities/memoryStorage';
import { algoritmoDeTratamentoDeMensagens } from '../services';
import { processNutritionJournal } from './nutritionJournalService';

interface AnalysisResult {
    found: boolean;
    informationType: string;
    value: string | number;
    originalMessage: string;
    confidence: number;
}

function extractInformationFromQuestion(question: string): { type: string | null, value: string | null } {
    const questionLower = question.toLowerCase();
    
    // Extrair objetivo da pergunta de confirmação
    if (questionLower.includes('objetivo é') || questionLower.includes('objetivo seria')) {
        if (questionLower.includes('ganho de massa')) {
            return { type: 'objetivo', value: 'ganho de massa muscular' };
        } else if (questionLower.includes('perda de peso')) {
            return { type: 'objetivo', value: 'perda de peso' };
        } else if (questionLower.includes('manutenção')) {
            return { type: 'objetivo', value: 'manutenção' };
        }
    }
    
    // Extrair nível de atividade
    if (questionLower.includes('nível de atividade') || questionLower.includes('atividade física')) {
        for (const level of ['sedentario', 'leve', 'moderado', 'ativo', 'muito ativo']) {
            if (questionLower.includes(level)) {
                return { type: 'nivel_atividade', value: level };
            }
        }
    }
    
    return { type: null, value: null };
}

async function quickAnalyzeMessage(message: string, historico: { role: string; content: string; timestamp: number; }[], openai: OpenAI): Promise<AnalysisResult[]> {
    const messageLower = message.toLowerCase().trim();
    const lastMessages = historico.slice(-2);
    const lastQuestion = lastMessages.length > 1 ? lastMessages[0].content.toLowerCase() : '';
    
    // Verificar confirmações diretas e objetivos
    if (lastQuestion.includes('objetivo') || lastQuestion.includes('meta')) {
        if (messageLower.includes('massa') || messageLower.includes('muscular') || messageLower.includes('ganhar')) {
            return [{
                found: true,
                informationType: 'objetivo',
                value: 'ganho de massa muscular',
                originalMessage: message,
                confidence: 0.9
            }];
        } else if (messageLower.includes('perd') || messageLower.includes('emagrecer')) {
            return [{
                found: true,
                informationType: 'objetivo',
                value: 'perda de peso',
                originalMessage: message,
                confidence: 0.9
            }];
        } else if (messageLower.includes('mant')) {
            return [{
                found: true,
                informationType: 'objetivo',
                value: 'manutenção',
                originalMessage: message,
                confidence: 0.9
            }];
        }
    }

    // Verificar outras confirmações diretas
    if (['sim', 'exato', 'exatamente', 'isso', 'isso mesmo', 'correto', 'é isso'].includes(messageLower)) {
        const extractedInfo = extractInformationFromQuestion(lastQuestion);
        if (extractedInfo.type && extractedInfo.value) {
            return [{
                found: true,
                informationType: extractedInfo.type,
                value: extractedInfo.value,
                originalMessage: message,
                confidence: 0.9
            }];
        }
    }

    const prompt = `Extraia informações nutricionais desta mensagem:
    
    MENSAGEM: "${message}"
    ÚLTIMA PERGUNTA: "${lastQuestion}"
    
    Retorne apenas um JSON array com as informações encontradas:
    [
        {
            "found": true,
            "informationType": "tipo_da_info",
            "value": "valor_encontrado",
            "originalMessage": "texto_original",
            "confidence": 0.9
        }
    ]`;

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'system', content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(completion.choices[0].message.content || "[]");
        return Array.isArray(result) ? result : [];
    } catch (error) {
        console.error("Erro na análise rápida:", error);
        return [];
    }
}

async function updatePatientWithAnalysis(patient: any, analyses: AnalysisResult[]): Promise<string[]> {
    const updatedFields: string[] = [];
    
    for (const analysis of analyses) {
        if (!analysis.found || analysis.confidence <= 0.7) continue;

        switch (analysis.informationType.toLowerCase()) {
            case 'peso':
                if (!patient.weight && !isNaN(Number(analysis.value))) {
                    patient.weight = Number(analysis.value);
                    updatedFields.push(`peso: ${analysis.value}kg`);
                }
                break;
            case 'altura':
                if (!patient.height && !isNaN(Number(analysis.value))) {
                    patient.height = Number(analysis.value);
                    updatedFields.push(`altura: ${analysis.value}cm`);
                }
                break;
            case 'nivel_atividade':
            case 'atividade_fisica':
                if (!patient.activityLevel) {
                    patient.activityLevel = String(analysis.value);
                    updatedFields.push(`nível de atividade: ${analysis.value}`);
                }
                break;
            case 'objetivo':
                if (!patient.goal) {
                    const goalText = String(analysis.value).toLowerCase();
                    if (goalText.includes('massa') || goalText.includes('muscular') || goalText.includes('ganhar')) {
                        patient.goal = 'ganho de massa muscular';
                    } else if (goalText.includes('perd') && goalText.includes('peso') || goalText.includes('emagrecer')) {
                        patient.goal = 'perda de peso';
                    } else if (goalText.includes('mant')) {
                        patient.goal = 'manutenção';
                    }
                    if (patient.goal) {
                        updatedFields.push(`objetivo: ${patient.goal}`);
                    }
                }
                break;
        }
    }

    return updatedFields;
}

export async function routeMessage(message: string, phone: string, openai: OpenAI): Promise<string> {
    try {
        const patient = MemoryStorage.getPacient(phone);
        const historicoDoDia = MemoryStorage.getHistoricoDoDia(phone);
        
        // Se a anamnese não está completa, continuar com o fluxo de anamnese
        if (!patient || !isAnamnesisComplete(patient)) {
            // Análise rápida inicial com GPT-3.5
            const analysisResults = await quickAnalyzeMessage(message, historicoDoDia, openai);
            
            if (analysisResults.length > 0 && patient) {
                const updatedFields = await updatePatientWithAnalysis(patient, analysisResults);
                if (updatedFields.length > 0) {
                    MemoryStorage.savePacient(phone, patient);
                    console.log("Campos atualizados:", updatedFields);
                    
                    // Se a anamnese foi completada com esta atualização, enviar mensagem de transição
                    if (isAnamnesisComplete(patient)) {
                        return `Pronto ${patient.name}! Sua análise está completa. Agora você pode começar a incluir suas refeições do dia. Sem pressa, estarei aqui esperando você me atualizar.`;
                    }
                }
            }
            return await algoritmoDeTratamentoDeMensagens(message, phone);
        }

        // Se a anamnese está completa, processar como diário nutricional
        return await processNutritionJournal(message, phone, openai);
    } catch (error) {
        console.error("Erro no roteamento de mensagem:", error);
        return "Ocorreu um erro ao processar sua mensagem. Pode tentar novamente?";
    }
}

function isAnamnesisComplete(patient: any): boolean {
    return patient.name && 
           patient.age && 
           patient.gender && 
           patient.weight && 
           patient.height && 
           patient.activityLevel && 
           patient.goal;
} 
import { OpenAI } from 'openai';
import { MemoryStorage } from '../entities/memoryStorage';
import { algoritmoDeTratamentoDeMensagens } from '../services';
import { processNutritionJournal } from './nutritionJournalService';
import { Pacient } from '../entities/Pacient';

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
    
    const contextPrompt = `
    Analise a mensagem do paciente e o contexto da conversa para extrair informações e gerar uma resposta empática.

    ÚLTIMA PERGUNTA: "${lastQuestion}"
    RESPOSTA DO PACIENTE: "${message}"

    OBJETIVOS:
    1. Extrair dados importantes (peso, altura, objetivo, etc.)
    2. Identificar o contexto emocional
    3. Detectar se há perguntas do paciente
    4. Manter uma conversa natural e empática

    CONTEXTOS POSSÍVEIS:
    - Objetivo fitness (perda de peso, ganho de massa, manutenção)
    - Dúvidas sobre nutrição
    - Preocupações com saúde
    - Frustração com dietas anteriores
    - Ansiedade sobre resultados
    - Dificuldades com alimentação

    Por favor, retorne um JSON com:
    {
        "analysis": [{
            "found": boolean,
            "informationType": string,
            "value": any,
            "confidence": number
        }],
        "context": {
            "hasQuestion": boolean,
            "emotionalTone": string,
            "concerns": string[],
            "requiresFollowUp": boolean
        },
        "suggestedResponse": string
    }`;

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: [{ role: 'system', content: contextPrompt }],
            temperature: 0.7,
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(completion.choices[0].message.content || "{}");
        
        // Se houver uma pergunta ou preocupação do paciente, salvar no contexto
        if (result.context?.hasQuestion || result.context?.concerns?.length > 0) {
            MemoryStorage.addContextoUtil(lastQuestion, message, 'pergunta_paciente', result.context.emotionalTone, result.context.concerns);
        }

        // Se tiver uma resposta sugerida, salvar para uso posterior
        if (result.suggestedResponse) {
            MemoryStorage.addMensagemAoHistorico(result.suggestedResponse, 'system');
        }

        return result.analysis || [];
    } catch (error) {
        console.error("Erro na análise contextual:", error);
        return [];
    }
}

async function updatePatientWithAnalysis(patient: any, analyses: AnalysisResult[]): Promise<string[]> {
    const updatedFields: string[] = [];
    
    for (const analysis of analyses) {
        if (!analysis.found || analysis.confidence <= 0.7) continue;

        switch (analysis.informationType.toLowerCase()) {
            case 'peso':
                if (!isNaN(Number(analysis.value))) {
                    patient.weight = Number(analysis.value);
                    updatedFields.push(`peso: ${analysis.value}kg`);
                }
                break;
            case 'altura':
                if (!isNaN(Number(analysis.value))) {
                    patient.height = Number(analysis.value);
                    updatedFields.push(`altura: ${analysis.value}cm`);
                }
                break;
            case 'nivel_atividade':
            case 'atividade_fisica':
                patient.activityLevel = String(analysis.value);
                updatedFields.push(`nível de atividade: ${analysis.value}`);
                break;
            case 'objetivo':
                const goalText = String(analysis.value).toLowerCase();
                if (goalText.includes('massa') || goalText.includes('muscular')) {
                    patient.goal = 'ganho de massa muscular';
                } else if (goalText.includes('perd') || goalText.includes('emagrecer')) {
                    patient.goal = 'perda de peso';
                } else if (goalText.includes('mant')) {
                    patient.goal = 'manutenção';
                }
                if (patient.goal) {
                    updatedFields.push(`objetivo: ${patient.goal}`);
                }
                break;
            case 'genero':
                if (['masculino', 'feminino'].includes(String(analysis.value).toLowerCase())) {
                    patient.gender = String(analysis.value).toLowerCase();
                    updatedFields.push(`gênero: ${patient.gender}`);
                }
                break;
            case 'idade':
                if (!isNaN(Number(analysis.value))) {
                    patient.age = Number(analysis.value);
                    updatedFields.push(`idade: ${patient.age}`);
                }
                break;
        }
    }
    
    return updatedFields;
}

async function analyzeMessageIntent(message: string, historico: any[], patient: Pacient | null, openai: OpenAI): Promise<{
    tipo: 'refeicao' | 'consulta_info' | 'duvida_nutricional' | 'outro';
    contexto: string;
    sugestao_resposta: string;
}> {
    const ultimasMensagens = historico.slice(-3);
    const contextoConversa = ultimasMensagens.map(msg => 
        `[${msg.role === 'system' ? 'ZIBU BOT' : 'CLIENTE'}]: ${msg.content}`
    ).join('\n');

    const prompt = `
    Analise esta mensagem do cliente no contexto de uma conversa com um assistente nutricional.

    CONTEXTO DA CONVERSA:
    ${contextoConversa}

    MENSAGEM ATUAL: "${message}"
    
    INFORMAÇÕES DO PACIENTE:
    ${patient ? JSON.stringify(patient, null, 2) : 'Ainda não coletadas'}

    OBJETIVO: Classificar a intenção da mensagem e gerar uma resposta apropriada.

    REGRAS DE CLASSIFICAÇÃO:
    1. PRIORIZE identificar menções a alimentos/refeições
    2. Se houver QUALQUER menção a comida, classifique como 'refeicao'
    3. Se for pergunta sobre dados do paciente, classifique como 'consulta_info'
    4. Se for dúvida sobre nutrição, classifique como 'duvida_nutricional'
    5. Outros casos, classifique como 'outro'

    EXEMPLOS:
    "Comi um pão" → refeicao
    "Quais são meus dados?" → consulta_info
    "Quantas calorias tem uma maçã?" → duvida_nutricional
    "Bom dia" → outro

    RETORNE UM JSON EXATO:
    {
      "classificacao": {
        "tipo": "refeicao" | "consulta_info" | "duvida_nutricional" | "outro",
        "confianca": "alta" | "media" | "baixa",
        "palavras_chave": string[]
      },
      "contexto": string,
      "sugestao_resposta": string
    }`;

    const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        response_format: { type: "json_object" }
    });

    try {
        const analysis = JSON.parse(response.choices[0].message.content || "{}");
        
        // Se for consulta de informações, formatar resposta com dados do paciente
        if (analysis.classificacao.tipo === 'consulta_info' && patient) {
            analysis.sugestao_resposta = `Claro! Aqui estão suas informações:
Nome: ${patient.name}
Idade: ${patient.age} anos
Peso: ${patient.weight}kg
Altura: ${patient.height}cm
Nível de Atividade: ${patient.activityLevel}
Objetivo: ${patient.goal}

Posso ajudar com mais alguma coisa? 😊`;
        }

        return {
            tipo: analysis.classificacao.tipo,
            contexto: analysis.contexto,
            sugestao_resposta: analysis.sugestao_resposta
        };
    } catch (error) {
        console.error('Erro ao analisar intenção da mensagem:', error);
        return {
            tipo: 'outro',
            contexto: 'Erro na análise',
            sugestao_resposta: 'Desculpe, não entendi sua mensagem. Pode reformular? 😅'
        };
    }
}

export async function routeMessage(message: string, phone: string, openai: OpenAI): Promise<string> {
    try {
        const patient = MemoryStorage.getPacient(phone);
        const historico = MemoryStorage.getHistoricoDoDia(phone);
        
        // Se a anamnese não está completa, continuar com o fluxo normal
        if (!patient || !isAnamnesisComplete(patient)) {
            return await algoritmoDeTratamentoDeMensagens(message, phone);
        }

        // Analisar a intenção da mensagem
        const analise = await analyzeMessageIntent(message, historico, patient, openai);
        console.log('Análise da mensagem:', analise);

        // Rotear baseado no tipo de mensagem
        switch (analise.tipo) {
            case 'refeicao':
                return await processNutritionJournal(message, phone, openai);
            
            case 'consulta_info':
            case 'duvida_nutricional':
            case 'outro':
                return analise.sugestao_resposta;
        }

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
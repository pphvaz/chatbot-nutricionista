import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { Pacient } from './entities/Pacient';
import basePrompt from './prompts/basePrompt';
import { analiseTMBPrompt, acompanhamentoPrompt, gerarResumoPaciente } from './prompts/nutritionPrompts';
import type { QuestionContext } from './entities/memoryStorage';
import { MemoryStorage } from './entities/memoryStorage';
import { generateOpenAIResponse } from './services/assistantService';
import { sendText } from './utils';

dotenv.config();
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Add this interface at the top of the file, after the imports
interface ExtractedInfo {
    name?: string;
    gender?: 'masculino' | 'feminino';
    age?: number;
    weight?: number;
    height?: number;
    activityLevel?: 'sedentario' | 'leve' | 'moderado' | 'ativo' | 'muito ativo';
    goal?: 'perda de peso' | 'ganho de massa muscular' | 'manutenção';
}

export async function algoritmoDeTratamentoDeMensagens(messageBuffer: string, phone: string) {
    // Buscar as informações do paciente
    const patient = await MemoryStorage.getPacient(phone);
    console.log('Estado inicial do paciente:', patient);

    // Adicionar a nova mensagem ao histórico
    MemoryStorage.addMensagemAoHistorico(phone, messageBuffer);

    // Verificar se é a primeira mensagem do usuário
    if (MemoryStorage.isFirstMessage(phone)) {
        // Extrair saudações comuns da mensagem do usuário
        const mensagemLower = messageBuffer.toLowerCase().trim();
        
        // Classificar o tipo de saudação
        let tipoSaudacao = 'nenhuma';
        
        // Saudação completa (com "tudo bem" ou similar)
        if (mensagemLower.includes('tudo bem') || 
            mensagemLower.includes('tudo bom') || 
            mensagemLower.includes('como vai')) {
            tipoSaudacao = 'completa';
        }
        // Saudação simples
        else if (mensagemLower === 'oi' || 
                 mensagemLower === 'olá' || 
                 mensagemLower === 'ola' || 
                 mensagemLower === 'hello' || 
                 mensagemLower === 'hey') {
            tipoSaudacao = 'simples';
        }

        // Array de mensagens para enviar em sequência
        const mensagens = [];

        // Responder de acordo com o tipo de saudação
        if (tipoSaudacao === 'completa') {
            mensagens.push(`Oi! Tudo ótimo, obrigada por perguntar! 😊`);
        } else if (tipoSaudacao === 'simples') {
            mensagens.push(`Oi! 😊`);
        }
        
        // Se houver saudação, esperar um pouco antes da próxima mensagem
        if (tipoSaudacao !== 'nenhuma') {
            await sendText(phone, mensagens[0]);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Espera 1 segundo
        }

        // Apresentação em partes
        mensagens.push(`Me chamo Zubi, sou uma nutricionista virtual especializada em ajudar pessoas a alcançarem seus objetivos de saúde. 🌱`);
        await sendText(phone, mensagens[mensagens.length - 1]);
        await new Promise(resolve => setTimeout(resolve, 1500)); // Espera 1.5 segundos

        mensagens.push(`Estou aqui para criar um plano nutricional personalizado para você. Para começarmos essa jornada juntos, poderia me dizer seu nome? 😊`);
        await sendText(phone, mensagens[mensagens.length - 1]);

        // Adicionar todas as mensagens ao histórico
        mensagens.forEach(msg => MemoryStorage.addMensagemAoHistorico(phone, msg));
        
        return ''; // Retorna vazio pois as mensagens já foram enviadas
    }

    // Obter histórico de mensagens do dia
    const historicoDoDia = MemoryStorage.getHistoricoDoDia(phone);
    const ultimasDuasMensagens = historicoDoDia.slice(-2);
    console.log('Últimas duas mensagens:', ultimasDuasMensagens);

    // Pegar a última pergunta feita pela assistente
    const ultimaPergunta = ultimasDuasMensagens.length >= 2 ? ultimasDuasMensagens[ultimasDuasMensagens.length - 2] : '';

    // Analisar a mensagem para extrair informações e identificar perguntas
    const analysisResult = await extractInformation(messageBuffer, ultimaPergunta, phone);
    console.log('Resultado da análise:', analysisResult);

    // Se houver uma pergunta do usuário, responda primeiro
    if (analysisResult.hasQuestion) {
        const questionPrompt = `
        Como uma nutricionista empática e profissional, responda à dúvida do paciente.
        
        Contexto da pergunta: ${analysisResult.questionContext}
        Dados do paciente: ${JSON.stringify(patient)}
        Última pergunta feita por você: "${ultimaPergunta}"
        Mensagem do paciente: "${messageBuffer}"

        Regras:
        1. Seja empática e compreensiva
        2. Explique o propósito das perguntas de forma clara
        3. Relacione a explicação com o objetivo do paciente
        4. Use linguagem acolhedora e profissional
        5. Mantenha a resposta concisa e focada
        `;

        const questionResponse = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "system", content: questionPrompt }],
            temperature: 0.7,
        });

        const resposta = questionResponse.choices[0].message.content || '';
        await sendText(phone, resposta);
        MemoryStorage.addMensagemAoHistorico(phone, resposta);

        // Aguardar um momento antes de continuar com o processo
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Se houver informações extraídas, processá-las
    if (analysisResult.extracted) {
        // Atualizar os dados do paciente com as informações extraídas
        updatePatientWithExtractedInfo(patient, analysisResult.extracted);
        MemoryStorage.savePacient(phone, patient);
        
        // Verificar se ainda faltam informações
        const missingFields = getMissingFields(patient);
        if (missingFields.length > 0) {
            // Aguardar um momento antes de fazer a próxima pergunta
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const nextQuestion = await generateNextQuestion(patient, missingFields[0]);
            MemoryStorage.addMensagemAoHistorico(phone, nextQuestion);
            return nextQuestion;
        } else {
            // Se acabamos de completar todas as informações, gerar análise inicial
            if (historicoDoDia[historicoDoDia.length - 2]?.includes('objetivo')) {
                const resumo = gerarResumoPaciente(patient);
                
                // Adicionar a última mensagem do paciente para contexto
                const ultimaMensagemPaciente = messageBuffer;
                
                const analise = await openai.chat.completions.create({
                    model: "gpt-4",
                    messages: [
                        { role: "system", content: analiseTMBPrompt },
                        { role: "user", content: `
Última mensagem do paciente: "${ultimaMensagemPaciente}"

${resumo}
                        ` }
                    ],
                    temperature: 0.7,
                });
                
                const respostaAnalise = analise.choices[0].message.content || '';
                MemoryStorage.addMensagemAoHistorico(phone, respostaAnalise);
                
                // Aguardar um momento antes de enviar a próxima mensagem para criar uma experiência mais natural
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Iniciar o acompanhamento com foco nas preocupações do paciente
                const inicioAcompanhamento = await openai.chat.completions.create({
                    model: "gpt-4",
                    messages: [
                        { role: "system", content: acompanhamentoPrompt },
                        { role: "user", content: `
Última mensagem do paciente: "${ultimaMensagemPaciente}"

${resumo}
                        ` }
                    ],
                    temperature: 0.7,
                });
                
                const respostaAcompanhamento = inicioAcompanhamento.choices[0].message.content || '';
                MemoryStorage.addMensagemAoHistorico(phone, respostaAcompanhamento);
                
                // Marcar que a primeira interação foi completada
                MemoryStorage.setPrimeiraInteracaoCompleta(phone);
                
                return `${respostaAnalise}\n\n${respostaAcompanhamento}`;
            }
        }
    }

    // Se todas as informações já foram coletadas anteriormente, usar o prompt de acompanhamento
    if (!getMissingFields(patient).length) {
        return await generateOpenAIResponse(openai, phone, acompanhamentoPrompt);
    }

    // Caso contrário, usar o prompt base
    const response = await generateOpenAIResponse(openai, phone, basePrompt);
    MemoryStorage.addMensagemAoHistorico(phone, response);
    return response;
}

async function extractInformation(message: string, ultimaPergunta: string = '', phone: string = '') {
    // Special handling for gender responses
    const isGenderQuestion = ultimaPergunta.toLowerCase().includes('homem ou mulher') || 
                           ultimaPergunta.toLowerCase().includes('h/m') ||
                           ultimaPergunta.toLowerCase().includes('sexo');
                           
    if (isGenderQuestion && message.length <= 2) {
        const normalizedResponse = message.trim().toLowerCase();
        if (['h', 'm', 'homem', 'mulher'].includes(normalizedResponse)) {
            const gender = (normalizedResponse === 'h' || normalizedResponse === 'homem') ? 'masculino' : 'feminino';
            return {
                extracted: {
                    gender: gender as 'masculino' | 'feminino'
                },
                hasQuestion: false,
                questionContext: null
            };
        }
    }

    // Special handling for height responses
    const isHeightQuestion = ultimaPergunta.toLowerCase().includes('altura') || 
                           ultimaPergunta.toLowerCase().includes('alto');
    if (isHeightQuestion) {
        const numberMatch = message.match(/(\d+[.,]\d+|\d+)/);
        if (numberMatch) {
            const number = parseFloat(numberMatch[0].replace(',', '.'));
            if (number > 1.4 && number < 2.2) {
                return {
                    extracted: {
                        height: number * 100
                    },
                    hasQuestion: false,
                    questionContext: null
                };
            } else if (number >= 140 && number <= 220) {
                return {
                    extracted: {
                        height: number
                    },
                    hasQuestion: false,
                    questionContext: null
                };
            }
        }
    }

    // Store question context if it's asking for specific information
    if (ultimaPergunta) {
        const questionType = determineQuestionType(ultimaPergunta);
        if (questionType) {
            MemoryStorage.addQuestionContext(phone, {
                question: ultimaPergunta,
                type: questionType,
                timestamp: Date.now()
            });
        }
    }

    // Get the last question context to help with interpretation
    const lastContext = MemoryStorage.getLastQuestionContext(phone);
    
    // If we have a short answer and a context, try to interpret it based on the context
    if (message.length <= 5 && lastContext) {
        const value = message.trim();
        switch (lastContext.type) {
            case 'gênero':
                if (['h', 'm', 'homem', 'mulher'].includes(value.toLowerCase())) {
                    const gender = (value.toLowerCase() === 'h' || value.toLowerCase() === 'homem') ? 'masculino' : 'feminino';
                    return {
                        extracted: {
                            gender: gender as 'masculino' | 'feminino'
                        },
                        hasQuestion: false,
                        questionContext: null
                    };
                }
                break;
            case 'idade':
                const age = parseInt(value);
                if (isValidAge(age)) {
                    return {
                        extracted: {
                            age
                        },
                        hasQuestion: false,
                        questionContext: null
                    };
                }
                break;
            case 'peso':
                const weight = parseFloat(value.replace(',', '.'));
                if (isValidWeight(weight)) {
                    return {
                        extracted: {
                            weight
                        },
                        hasQuestion: false,
                        questionContext: null
                    };
                }
                break;
            case 'altura':
                const height = parseFloat(value.replace(',', '.'));
                if (height > 1.4 && height < 2.2) {
                    return {
                        extracted: {
                            height: height * 100
                        },
                        hasQuestion: false,
                        questionContext: null
                    };
                } else if (height >= 140 && height <= 220) {
                    return {
                        extracted: {
                            height
                        },
                        hasQuestion: false,
                        questionContext: null
                    };
                }
                break;
        }
    }

    // Check if this might be an initial message with all information
    const isLikelyInitialMessage = message.toLowerCase().includes('eu sou') || 
                                  (message.toLowerCase().includes('olá') && message.length > 100);

    if (isLikelyInitialMessage) {
        // Use a prompt optimized for complete initial messages
        const initialPrompt = `
        Analise cuidadosamente esta mensagem inicial do paciente:
        "${message}"

        Extraia TODAS as informações fornecidas de uma vez.
        
        Formate sua resposta exatamente assim:

        INFORMAÇÕES COMPLETAS:
        - Nome: [valor exato]
        - Idade: [número]
        - Gênero: [masculino/feminino]
        - Peso: [número em kg]
        - Altura: [número em metros]
        - Nível de Atividade: [sedentario/leve/moderado/ativo/muito ativo]
        - Objetivo: [perda de peso/ganho de massa muscular/manutenção]

        ANÁLISE:
        - Há pergunta do paciente? [sim/não]
        - Contexto da pergunta: [descrição ou null]
        - Confiança geral: [alta/média/baixa]
        `;

        const analysisResponse = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: initialPrompt }],
            temperature: 0.1,
        });

        const analysisContent = analysisResponse.choices[0].message.content;
        if (!analysisContent) {
            return { extracted: null, hasQuestion: false, questionContext: null };
        }

        console.log('Análise completa (mensagem inicial):', analysisContent);

        const extractedInfo: ExtractedInfo = {};
        const lines = analysisContent.split('\n');

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('- Nome:')) {
                const name = trimmedLine.split(':')[1].trim();
                if (isValidName(name)) {
                    extractedInfo.name = name;
                }
            } else if (trimmedLine.startsWith('- Gênero:')) {
                const gender = trimmedLine.split(':')[1].trim();
                if (isValidGender(gender)) {
                    extractedInfo.gender = gender as 'masculino' | 'feminino';
                }
            } else if (trimmedLine.startsWith('- Idade:')) {
                const age = parseInt(trimmedLine.split(':')[1].trim());
                if (isValidAge(age)) {
                    extractedInfo.age = age;
                }
            } else if (trimmedLine.startsWith('- Peso:')) {
                const weight = parseFloat(trimmedLine.split(':')[1].trim());
                if (isValidWeight(weight)) {
                    extractedInfo.weight = weight;
                }
            } else if (trimmedLine.startsWith('- Altura:')) {
                let height = parseFloat(trimmedLine.split(':')[1].trim());
                if (height < 3) { // Se altura está em metros
                    height = height * 100;
                }
                if (isValidHeight(height)) {
                    extractedInfo.height = height;
                }
            } else if (trimmedLine.startsWith('- Nível de Atividade:')) {
                const level = trimmedLine.split(':')[1].trim();
                if (isValidActivityLevel(level)) {
                    extractedInfo.activityLevel = level as 'sedentario' | 'leve' | 'moderado' | 'ativo' | 'muito ativo';
                }
            } else if (trimmedLine.startsWith('- Objetivo:')) {
                const goal = trimmedLine.split(':')[1].trim();
                if (isValidGoal(goal)) {
                    extractedInfo.goal = goal as 'perda de peso' | 'ganho de massa muscular' | 'manutenção';
                }
            }
        }

        const hasQuestion = analysisContent.includes('Há pergunta do paciente? sim');
        const questionContextMatch = analysisContent.match(/Contexto da pergunta: (.+)/);
        const questionContext = questionContextMatch ? questionContextMatch[1].trim() : null;

        // Debug logging
        console.log('Mensagem original:', message);
        console.log('Informações extraídas e validadas:', extractedInfo);

        return {
            extracted: Object.keys(extractedInfo).length > 0 ? extractedInfo : null,
            hasQuestion,
            questionContext: questionContext === 'null' ? null : questionContext
        };
    }

    // If not an initial message, use the iterative approach for follow-up messages
    let remainingText = message;
    let allExtractedInfo: ExtractedInfo = {};
    let hasQuestionFound = false;
    let questionContextFound = null;
    
    // Continue processing while we have text and haven't processed more than 5 iterations
    let iterations = 0;
    const MAX_ITERATIONS = 5;

    while (remainingText.trim() && iterations < MAX_ITERATIONS) {
        iterations++;
        
        const analysisPrompt = `
        Analise esta parte da mensagem do paciente:
        "${remainingText}"

        Identifique a PRIMEIRA informação útil encontrada.
        
        Formate sua resposta assim:

        INFORMAÇÃO ENCONTRADA:
        - Tipo: [nome/gênero/idade/peso/altura/nivel_atividade/objetivo]
        - Valor: [valor extraído]
        - Texto Original: [parte exata do texto que contém a informação]
        - Texto Restante: [todo o texto após a informação encontrada]
        - Confiança: [alta/média/baixa]

        ANÁLISE:
        - Há pergunta do paciente? [sim/não]
        - Contexto da pergunta: [descrição ou null]
        `;

        const analysisResponse = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{ role: "user", content: analysisPrompt }],
            temperature: 0.1,
        });

        const analysisContent = analysisResponse.choices[0].message.content;
        if (!analysisContent) break;

        console.log(`Iteração ${iterations} - Análise:`, analysisContent);

        // Extract the information type and value
        const typeMatch = analysisContent.match(/Tipo: (.+)/);
        const valueMatch = analysisContent.match(/Valor: (.+)/);
        const remainingMatch = analysisContent.match(/Texto Restante: (.+)/);
        
        if (typeMatch && valueMatch) {
            const type = typeMatch[1].trim();
            const value = valueMatch[1].trim();
            
            if (remainingMatch) {
                remainingText = remainingMatch[1].trim();
            }

            // Process the extracted information based on type
            switch (type) {
                case 'nome':
                    if (isValidName(value)) {
                        allExtractedInfo.name = value;
                    }
                    break;
                case 'gênero':
                    if (isValidGender(value)) {
                        allExtractedInfo.gender = value as 'masculino' | 'feminino';
                    }
                    break;
                case 'idade':
                    const age = parseInt(value);
                    if (isValidAge(age)) {
                        allExtractedInfo.age = age;
                    }
                    break;
                case 'peso':
                    const weight = parseFloat(value);
                    if (isValidWeight(weight)) {
                        allExtractedInfo.weight = weight;
                    }
                    break;
                case 'altura':
                    let height = parseFloat(value);
                    if (height < 3) {
                        height = height * 100;
                    }
                    if (isValidHeight(height)) {
                        allExtractedInfo.height = height;
                    }
                    break;
                case 'nivel_atividade':
                    if (isValidActivityLevel(value)) {
                        allExtractedInfo.activityLevel = value as 'sedentario' | 'leve' | 'moderado' | 'ativo' | 'muito ativo';
                    }
                    break;
                case 'objetivo':
                    if (isValidGoal(value)) {
                        allExtractedInfo.goal = value as 'perda de peso' | 'ganho de massa muscular' | 'manutenção';
                    }
                    break;
            }

            if (!hasQuestionFound && analysisContent.includes('Há pergunta do paciente? sim')) {
                hasQuestionFound = true;
                const contextMatch = analysisContent.match(/Contexto da pergunta: (.+)/);
                if (contextMatch) {
                    questionContextFound = contextMatch[1].trim();
                }
            }
        } else {
            break;
        }
    }

    return {
        extracted: Object.keys(allExtractedInfo).length > 0 ? allExtractedInfo : null,
        hasQuestion: hasQuestionFound,
        questionContext: questionContextFound === 'null' ? null : questionContextFound
    };
}

function determineQuestionType(question: string): QuestionContext['type'] | null {
    const questionLower = question.toLowerCase();
    
    if (questionLower.includes('nome')) return 'nome';
    if (questionLower.includes('homem ou mulher') || questionLower.includes('sexo')) return 'gênero';
    if (questionLower.includes('idade') || questionLower.includes('anos')) return 'idade';
    if (questionLower.includes('peso') || questionLower.includes('quilos')) return 'peso';
    if (questionLower.includes('altura') || questionLower.includes('alto')) return 'altura';
    if (questionLower.includes('atividade') || questionLower.includes('exercício')) return 'nivel_atividade';
    if (questionLower.includes('objetivo') || questionLower.includes('meta')) return 'objetivo';
    
    return null;
}

async function inferGenderFromName(name: string): Promise<string | null> {
    const prompt = `
    Analise o seguinte nome e determine o gênero biológico mais provável com base nos padrões de nomes em português.
    Nome: "${name}"
    
    Regras:
    1. Retorne APENAS "masculino" ou "feminino" se tiver alta confiança
    2. Retorne "null" se o nome for ambíguo ou não tiver certeza
    3. Considere:
       - Terminações típicas (-a, -ana, -ela para feminino; -o, -dro, -los para masculino)
       - Nomes compostos (considere todas as partes)
       - Nomes tradicionalmente associados a cada gênero
    
    Exemplos:
    "Maria" -> "feminino"
    "João" -> "masculino"
    "Alex" -> null
    "Andrea" -> null (pode ser usado para ambos os gêneros)
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
    });

    const inferredGender = response.choices[0].message.content?.trim().toLowerCase();
    if (inferredGender === 'masculino' || inferredGender === 'feminino') {
        return inferredGender;
    }
    return null;
}

function updatePatientWithExtractedInfo(patient: Pacient, info: any) {
    console.log('Atualizando paciente com informações:', info);
    
    if (info.name && isValidName(info.name)) {
        console.log('Nome válido:', info.name);
        patient.name = info.name;
    }
    if (info.age && isValidAge(info.age)) {
        console.log('Idade válida:', info.age);
        patient.age = info.age;
    }
    if (info.gender && isValidGender(info.gender)) {
        console.log('Gênero válido:', info.gender);
        patient.gender = info.gender;
    }
    if (info.weight && isValidWeight(info.weight)) {
        console.log('Peso válido:', info.weight);
        patient.weight = info.weight;
    }
    if (info.height && isValidHeight(info.height)) {
        console.log('Altura válida:', info.height);
        patient.height = info.height;
    }
    if (info.activityLevel && isValidActivityLevel(info.activityLevel)) {
        console.log('Nível de atividade válido:', info.activityLevel);
        patient.activityLevel = info.activityLevel;
    }
    if (info.goal && isValidGoal(info.goal)) {
        console.log('Objetivo válido:', info.goal);
        patient.goal = info.goal;
    }
    
    console.log('Estado atual do paciente:', patient);
}

function getMissingFields(patient: Pacient): string[] {
    const missing = [];
    if (!patient.name) missing.push('nome');
    if (!patient.age) missing.push('idade');
    if (!patient.gender) missing.push('sexo');
    if (!patient.weight) missing.push('peso');
    if (!patient.height) missing.push('altura');
    if (!patient.activityLevel) missing.push('nível de atividade física');
    if (!patient.goal) missing.push('objetivo');
    return missing;
}

async function generateNextQuestion(patient: Pacient, missingField: string): Promise<string> {
    const prompt = `
    Como uma nutricionista profissional, gere uma pergunta direta e objetiva para obter o(a) ${missingField} do paciente.
    Considere o que já sabemos sobre o paciente:
    ${JSON.stringify(patient, null, 2)}
    
    Regras:
    1. Se o campo for 'sexo', pergunte apenas "Você é homem ou mulher? (H/M)"
    2. Se faltam altura E peso, pergunte os dois juntos: "Qual sua altura (em cm) e peso (em kg)?"
    3. Se o campo for 'nível de atividade física', use a seguinte estrutura:
       "Qual é o seu nível de atividade física semanal?
       
       Escolha uma das opções:
       - Sedentário (pouco ou nenhum exercício)
       - Leve (exercício 1-3 vezes por semana)
       - Moderado (exercício 3-5 vezes por semana)
       - Ativo (exercício 6-7 vezes por semana)
       - Muito ativo (exercícios intensos, 6-7 vezes por semana)"
    4. Mantenha as perguntas diretas e profissionais
    5. Evite linguagem muito informal ou emojis excessivos
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
    });

    const perguntaGerada = response.choices[0].message.content || `Por favor, me informe seu ${missingField}:`;
    
    // Se ainda faltam altura e peso, combine as perguntas
    if (missingField === 'altura' && !patient.weight) {
        return "Qual sua altura (em cm) e peso (em kg)?";
    }
    
    // Se for pergunta de gênero, use o formato direto
    if (missingField === 'sexo') {
        return "Você é homem ou mulher? (H/M)";
    }

    // Se for nível de atividade física, use o formato padronizado
    if (missingField === 'nível de atividade física') {
        return `Qual é o seu nível de atividade física semanal?

Escolha uma das opções:
- Sedentário (pouco ou nenhum exercício)
- Leve (exercício 1-3 vezes por semana)
- Moderado (exercício 3-5 vezes por semana)
- Ativo (exercício 6-7 vezes por semana)
- Muito ativo (exercícios intensos, 6-7 vezes por semana)`;
    }
    
    return perguntaGerada;
}

// Funções de validação
function isValidName(name: string): boolean {
    if (!name || typeof name !== 'string') return false;
    
    // Remove extra spaces and normalize
    const cleanName = name.trim().replace(/\s+/g, ' ');
    
    // Check minimum length (2 characters)
    if (cleanName.length < 2) return false;
    
    // Check if contains only letters, spaces, and common name characters
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ\s'-]+$/.test(cleanName)) return false;
    
    // Check if it's not just spaces or special characters
    if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(cleanName)) return false;
    
    // Check if it's not too long (reasonable maximum length for a name)
    if (cleanName.length > 100) return false;
    
    return true;
}

function isValidAge(age: number): boolean {
    return typeof age === 'number' && age > 0 && age < 120;
}

function isValidGender(gender: string): boolean {
    return ['masculino', 'feminino'].includes(gender.toLowerCase());
}

function isValidWeight(weight: number): boolean {
    return typeof weight === 'number' && weight > 20 && weight < 300;
}

function isValidHeight(height: number): boolean {
    return typeof height === 'number' && height > 100 && height < 250;
}

function isValidActivityLevel(level: string): boolean {
    return ['sedentario', 'leve', 'moderado', 'ativo', 'muito ativo'].includes(level.toLowerCase());
}

function isValidGoal(goal: string): boolean {
    return ['perda de peso', 'ganho de massa muscular', 'manutenção'].includes(goal.toLowerCase());
}

export async function generateAnswer(openai: OpenAI, message: string, prompt: string) {

    // Verifica se a mensagem contém informações sobre o paciente
    const data = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
            { role: "system", content: prompt },
            { role: "user", content: message }
        ],
        temperature: 0.8,
    });

    const response = data.choices[0].message.content;

    console.log('Resposta da OpenAI:', response);

    if (!response) {
        return 'Desculpe, não consegui entender a sua mensagem. Por favor, tente novamente.';
    }

    return `${response}`;
}


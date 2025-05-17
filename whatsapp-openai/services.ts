import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { Pacient } from './entities/Pacient';
import basePrompt from './prompts/basePrompt';
import { analiseTMBPrompt, acompanhamentoPrompt, gerarResumoPaciente } from './prompts/nutritionPrompts';
import { MemoryStorage } from './entities/memoryStorage';
import { generateOpenAIResponse } from './services/assistantService';
dotenv.config();
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function algoritmoDeTratamentoDeMensagens(messageBuffer: string, phone: string) {
    // Buscar as informações do paciente
    const patient = await MemoryStorage.getPacient(phone);
    console.log('Estado inicial do paciente:', patient);

    // Adicionar a nova mensagem ao histórico
    MemoryStorage.addMensagemAoHistorico(phone, messageBuffer);

    // Verificar se é a primeira mensagem do usuário
    if (MemoryStorage.isFirstMessage(phone)) {
        const introducao = `Olá! 👋 Eu sou a Zubi, sua nutricionista virtual. Estou aqui para ajudar você a alcançar seus objetivos nutricionais de forma personalizada. Para começarmos, qual é o seu nome?`;
        MemoryStorage.addMensagemAoHistorico(phone, introducao);
        return introducao;
    }

    // Obter histórico de mensagens do dia
    const historicoDoDia = MemoryStorage.getHistoricoDoDia(phone);
    const ultimasDuasMensagens = historicoDoDia.slice(-2);
    console.log('Últimas duas mensagens:', ultimasDuasMensagens);

    // Analisar a mensagem para extrair informações
    const extractedInfo = await extractInformation(messageBuffer);
    console.log('Informações extraídas:', extractedInfo);

    if (extractedInfo) {
        // Se for uma resposta simples (sim/não) para gênero, verificar a pergunta anterior
        if (ultimasDuasMensagens.length >= 2) {
            const perguntaAnterior = ultimasDuasMensagens[ultimasDuasMensagens.length - 2].toLowerCase();
            const respostaAtual = messageBuffer.toLowerCase();

            if (perguntaAnterior.includes('sexo') || perguntaAnterior.includes('homem') || perguntaAnterior.includes('mulher')) {
                if (respostaAtual === 'sim' || respostaAtual.includes('homem')) {
                    extractedInfo.gender = 'masculino';
                } else if (respostaAtual === 'não' || respostaAtual.includes('mulher')) {
                    extractedInfo.gender = 'feminino';
                }
            }

            // Armazenar contexto útil se alguma informação foi extraída
            for (const [campo, valor] of Object.entries(extractedInfo)) {
                if (valor) {
                    MemoryStorage.addContextoUtil(phone, campo, perguntaAnterior, respostaAtual);
                }
            }
        }

        // Atualizar os dados do paciente com as informações extraídas
        updatePatientWithExtractedInfo(patient, extractedInfo);
        MemoryStorage.savePacient(phone, patient);
        
        // Verificar se ainda faltam informações
        const missingFields = getMissingFields(patient);
        if (missingFields.length > 0) {
            const nextQuestion = await generateNextQuestion(patient, missingFields[0]);
            MemoryStorage.addMensagemAoHistorico(phone, nextQuestion);
            return nextQuestion;
        } else {
            // Se acabamos de completar todas as informações, gerar análise inicial
            if (historicoDoDia[historicoDoDia.length - 2]?.includes('objetivo')) {
                const resumo = gerarResumoPaciente(patient);
                const analise = await openai.chat.completions.create({
                    model: "gpt-4",
                    messages: [
                        { role: "system", content: analiseTMBPrompt },
                        { role: "user", content: resumo }
                    ],
                    temperature: 0.7,
                });
                
                const respostaAnalise = analise.choices[0].message.content || '';
                MemoryStorage.addMensagemAoHistorico(phone, respostaAnalise);
                
                // Após enviar a análise, iniciar o acompanhamento
                const inicioAcompanhamento = await openai.chat.completions.create({
                    model: "gpt-4",
                    messages: [
                        { role: "system", content: acompanhamentoPrompt },
                        { role: "user", content: resumo }
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

async function extractInformation(message: string) {
    const prompt = `
    Analise a seguinte mensagem e extraia informações relevantes para anamnese nutricional.
    Se encontrar alguma das informações abaixo, retorne em formato JSON, caso contrário retorne null.
    
    Considere também respostas simples como:
    - "sim" ou "masculino" para confirmar gênero masculino
    - "não" ou "feminino" para confirmar gênero feminino
    - Números sozinhos podem ser idade, peso ou altura dependendo do contexto
    
    Informações a serem extraídas:
    - name: nome da pessoa (se contiver apenas letras e espaços)
    - age: idade em anos (número)
    - gender: "masculino" ou "feminino"
    - weight: peso em kg (número)
    - height: altura em cm (número)
    - activityLevel: "sedentario", "leve", "moderado", "ativo", ou "muito ativo"
    - goal: "perda de peso", "ganho de massa muscular", ou "manutenção"

    Mensagem: "${message}"

    Retorne apenas o JSON com os campos encontrados, ou null se nenhum campo for identificado.
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
    });

    try {
        const content = response.choices[0].message.content;
        if (content && content.toLowerCase() !== "null") {
            const extractedInfo = JSON.parse(content);
            
            // Validação adicional para respostas simples
            if (message.toLowerCase() === 'sim' || message.toLowerCase() === 'masculino') {
                extractedInfo.gender = 'masculino';
            } else if (message.toLowerCase() === 'não' || message.toLowerCase() === 'feminino') {
                extractedInfo.gender = 'feminino';
            }
            
            return extractedInfo;
        }
    } catch (error) {
        console.error("Erro ao processar resposta:", error);
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
    Como uma nutricionista amigável, gere uma pergunta natural para obter o(a) ${missingField} do paciente.
    Considere o que já sabemos sobre o paciente:
    ${JSON.stringify(patient, null, 2)}
    
    Faça a pergunta de forma conversacional e empática.
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
    });

    return response.choices[0].message.content || `Por favor, me fale seu ${missingField}:`;
}

// Funções de validação
function isValidName(name: string): boolean {
    return typeof name === 'string' && 
           name.trim().length >= 2 && 
           /^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/.test(name.trim());
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


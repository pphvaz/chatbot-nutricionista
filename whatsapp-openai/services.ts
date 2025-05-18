import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { Pacient } from './entities/Pacient';
import basePrompt from './prompts/basePrompt';
import { analiseTMBPrompt, acompanhamentoPrompt, gerarResumoPaciente } from './prompts/nutritionPrompts';
import type { QuestionContext } from './entities/memoryStorage';
import { MemoryStorage } from './entities/memoryStorage';
import { generateOpenAIResponse } from './services/assistantService';
import { sendText } from './utils';
import { processNewMeal } from './services/mealTrackingService';

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

// Adicionar no topo do arquivo, junto com as outras interfaces
const GENDER_VALUES = {
    MASCULINO: 'masculino' as const,
    FEMININO: 'feminino' as const
};

type Gender = 'masculino' | 'feminino';

export async function algoritmoDeTratamentoDeMensagens(messageBuffer: string, phone: string) {
    // Clean up the message by removing the Zapi free tier prefix
    const cleanMessage = messageBuffer.replace(/Enviada por uma conta TESTE gratuita!\n\nSua mensagem abaixo: 👇\n/g, '').trim();
    
    // Buscar as informações do paciente
    const patient = await MemoryStorage.getPacient(phone);
    console.log('Estado inicial do paciente:', patient);

    // Adicionar a mensagem limpa ao histórico como mensagem do usuário
    MemoryStorage.addMensagemAoHistorico(phone, cleanMessage, 'user');

    // Verificar se é a primeira mensagem do usuário
    if (MemoryStorage.isFirstMessage(phone)) {
        // Extrair saudações comuns da mensagem do usuário
        const mensagemLower = cleanMessage.toLowerCase().trim();
        
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
            const resposta = `Oi! Tudo ótimo, obrigada por perguntar! 😊`;
            mensagens.push(resposta);
            MemoryStorage.addMensagemAoHistorico(phone, resposta, 'system');
        } else if (tipoSaudacao === 'simples') {
            const resposta = `Oi! 😊`;
            mensagens.push(resposta);
            MemoryStorage.addMensagemAoHistorico(phone, resposta, 'system');
        }
        
        // Se houver saudação, esperar um pouco antes da próxima mensagem
        if (tipoSaudacao !== 'nenhuma') {
            await sendText(phone, mensagens[0]);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Espera 1 segundo
        }

        // Apresentação em partes
        const apresentacao = `Me chamo Zibu, sou seu nutri journal. 🌱`;
        mensagens.push(apresentacao);
        MemoryStorage.addMensagemAoHistorico(phone, apresentacao, 'system');
        await sendText(phone, apresentacao);
        await new Promise(resolve => setTimeout(resolve, 1500)); // Espera 1.5 segundos

        const perguntaNome = `Estou aqui para te ajudar a controlar sua alimentação. Poderia me dizer seu nome? 😊`;
        mensagens.push(perguntaNome);
        MemoryStorage.addMensagemAoHistorico(phone, perguntaNome, 'system');
        await sendText(phone, perguntaNome);
        
        return '';
    }

    // Obter últimas mensagens
    const ultimasMensagens = MemoryStorage.getUltimasMensagens(phone, 2);
    console.log('Últimas duas mensagens:', ultimasMensagens);

    // Se todas as informações já foram coletadas E a primeira interação foi completada,
    // não precisamos mais analisar como anamnese
    if (!getMissingFields(patient).length && MemoryStorage.isPrimeiraInteracaoCompleta(phone)) {
        return await processNewMeal(cleanMessage, phone, openai);
    }

    // Pegar a última pergunta feita pela assistente
    const ultimaPergunta = MemoryStorage.getUltimaPerguntaSistema(phone);

    // Analisar a mensagem para extrair informações e identificar perguntas
    const analysisResult = await extractInformation(cleanMessage, ultimaPergunta || '', phone);
    console.log('Resultado da análise:', analysisResult);

    // Se houver uma pergunta do usuário (incluindo pedidos de esclarecimento)
    if (analysisResult.hasQuestion || cleanMessage.toLowerCase().match(/^(como assim|não entendi|pode explicar|explica melhor|o que quer dizer)\??$/)) {
        let nextQuestion = '';
        
        // Se for uma pergunta de esclarecimento, gerar uma resposta mais direta
        if (cleanMessage.toLowerCase().match(/^(como assim|não entendi|pode explicar|explica melhor|o que quer dizer)\??$/)) {
            const missingFields = getMissingFields(patient);
            const currentField = missingFields[0];
            
            let explanation = '';
            switch(currentField) {
                case 'nível de atividade física':
                    explanation = 'Me diz se você faz exercícios e com que frequência! 🏃‍♂️\nEscolha: sedentário, leve, moderado, ativo ou muito ativo.';
                    break;
                case 'objetivo':
                    explanation = 'Me conta o que você quer alcançar: perder peso, ganhar massa muscular ou manter seu peso atual? 🎯';
                    break;
                case 'peso':
                    explanation = 'Preciso saber seu peso em kg para calcular suas necessidades! ⚖️';
                    break;
                case 'altura':
                    explanation = 'Me diz sua altura em centímetros para eu calcular seu IMC! 📏';
                    break;
                default:
                    explanation = 'Desculpe, pode reformular sua pergunta? 😊';
            }
            
            await sendText(phone, explanation);
            MemoryStorage.addMensagemAoHistorico(phone, explanation, 'system');
            
            // Se tiver uma pergunta anterior, repeti-la
            if (ultimaPergunta) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                await sendText(phone, ultimaPergunta);
                MemoryStorage.addMensagemAoHistorico(phone, ultimaPergunta, 'system');
            }
            return '';
        }
        
        // Para outras perguntas, usar o processamento normal
        const questionPrompt = `
        Como nutricionista, responda de forma BREVE e DIRETA:
        
        Pergunta do paciente: "${cleanMessage}"
        Contexto: ${analysisResult.questionContext || 'Sem contexto específico'}
        Última pergunta: "${ultimaPergunta || 'Nenhuma'}"

        Regras:
        1. Resposta CURTA (máximo 2 frases)
        2. Linguagem simples
        3. Use emoji
        `;

        const questionResponse = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [{ role: "system", content: questionPrompt }],
            temperature: 0.7,
        });

        const resposta = questionResponse.choices[0].message.content || '';
        await sendText(phone, resposta);
        MemoryStorage.addMensagemAoHistorico(phone, resposta, 'system');

        // Se tiver uma pergunta anterior pendente, repeti-la
        if (ultimaPergunta) {
            await new Promise(resolve => setTimeout(resolve, 1500));
            await sendText(phone, ultimaPergunta);
            MemoryStorage.addMensagemAoHistorico(phone, ultimaPergunta, 'system');
        }
        return '';
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
            
            const nextQuestion = await generateNextQuestion(patient, missingFields[0], phone);
            MemoryStorage.addMensagemAoHistorico(phone, nextQuestion, 'system');
            return nextQuestion;
        } else {
            // Se acabamos de completar todas as informações, gerar análise inicial
            const resumo = gerarResumoPaciente(patient);
            console.log('TMB e informações do paciente:', resumo);
            const analise = await openai.chat.completions.create({
                model: "gpt-4.1",
                messages: [
                    { role: "system", content: analiseTMBPrompt },
                    { role: "user", content: resumo }
                ],
                temperature: 0.7,
            });
            
            const respostaAnalise = analise.choices[0].message.content || '';
            console.log('Resposta da análise:', respostaAnalise);
            MemoryStorage.addMensagemAoHistorico(phone, respostaAnalise, 'system');
            
            // Adicionar mensagem de transição
            const mensagemTransicao = `\n\nAgora você pode começar a registrar suas refeições! Me conte o que você comeu 🍽️`;
            await sendText(phone, mensagemTransicao);
            MemoryStorage.addMensagemAoHistorico(phone, mensagemTransicao, 'system');
            
            // Marcar que a primeira interação foi completada
            MemoryStorage.setPrimeiraInteracaoCompleta(phone);
            
            return respostaAnalise;
        }
    }

    // Se todas as informações já foram coletadas anteriormente, usar o prompt de acompanhamento
    if (!getMissingFields(patient).length) {
        // Se acabamos de completar a anamnese, mostrar resumo conciso
        console.log('Últimas mensagens:', ultimasMensagens);
        if (ultimasMensagens.length >= 2 && 
            (ultimasMensagens[0].content.includes('objetivo') || 
             ultimasMensagens[0].content.includes('meta'))) {
            const resumo = gerarResumoPaciente(patient);
            const analise = await openai.chat.completions.create({
                model: "gpt-4.1",
                messages: [
                    { role: "system", content: analiseTMBPrompt },
                    { role: "user", content: resumo }
                ],
                temperature: 0.7,
            });
            
            const respostaAnalise = analise.choices[0].message.content || '';
            MemoryStorage.addMensagemAoHistorico(phone, respostaAnalise, 'system');
            return respostaAnalise;
        }

        // Para mensagens subsequentes, verificar se já completou a primeira interação
        if (MemoryStorage.isPrimeiraInteracaoCompleta(phone)) {
            // Usar IA para classificar a mensagem
            const messageType = await classifyMessage(cleanMessage, openai);
            
            if (messageType === 'refeicao') {
                return await processNewMeal(cleanMessage, phone, openai);
            }
        } else {
            // Se ainda não completou a primeira interação, enviar mensagem de transição
            const mensagemTransicao = `Ótimo! Agora você pode começar a registrar suas refeições! Me conte o que você comeu 🍽️`;
            MemoryStorage.setPrimeiraInteracaoCompleta(phone);
            MemoryStorage.addMensagemAoHistorico(phone, mensagemTransicao, 'system');
            return mensagemTransicao;
        }
    }

    // Caso contrário, usar o prompt base
    const response = await generateOpenAIResponse(openai, phone, basePrompt);
    MemoryStorage.addMensagemAoHistorico(phone, response, 'system');
    return response;
}

async function extractInformation(message: string, ultimaPergunta: string = '', phone: string = '') {
    const historico = MemoryStorage.getHistoricoDoDia(phone);
    const ultimasMensagens = historico.slice(-3); // Últimas 3 mensagens para contexto
    const contextoConversa = ultimasMensagens.map(msg => 
        `[${msg.role === 'system' ? 'ZIBU BOT' : 'CLIENTE'}]: ${msg.content}`
    ).join('\n');

    const prompt = `
    Analise cuidadosamente esta conversa entre o bot nutricional (Zibu) e o cliente.
    
    CONTEXTO DA CONVERSA (3 últimas mensagens):
    ${contextoConversa}
    
    MENSAGEM ATUAL DO CLIENTE: "${message}"
    ÚLTIMA PERGUNTA DO BOT: "${ultimaPergunta}"

    OBJETIVO: Extrair APENAS informações fornecidas pelo CLIENTE, ignorando mensagens do bot.

    IMPORTANTE:
    1. APENAS analise as mensagens do CLIENTE, IGNORE as mensagens do BOT
    2. Considere diferentes formatos de números (1.80m, 180cm, 1,80 são a mesma altura)
    3. Interprete unidades implícitas baseado no contexto
    4. Considere gírias e linguagem informal
    5. Identifique informações mesmo quando expressas de forma indireta
    
    EXEMPLOS DE INTERPRETAÇÃO:
    [ZIBU BOT]: "Qual sua altura?"
    [CLIENTE]: "Um e oitenta" → altura: 180cm
    
    [ZIBU BOT]: "Me diz seu peso?"
    [CLIENTE]: "Tô com 86" → peso: 86kg
    
    [ZIBU BOT]: "Como você se exercita?"
    [CLIENTE]: "Malho todo dia" → nível de atividade: muito ativo
    
    [ZIBU BOT]: "Me diz seu nome?"
    [CLIENTE]: "Pedro" → nome: Pedro
    [ZIBU BOT]: "Olá Pedro!" → IGNORAR, é mensagem do bot
    
    RETORNE UM JSON EXATO:
    {
      "informacoes": {
        "nome": string | null,
        "idade": number | null,
        "genero": "masculino" | "feminino" | null,
        "peso": number | null,
        "altura": number | null,
        "nivel_atividade": "sedentario" | "leve" | "moderado" | "ativo" | "muito ativo" | null,
        "objetivo": "perda de peso" | "ganho de massa muscular" | "manutenção" | null
      },
      "analise": {
        "tem_pergunta": boolean,
        "contexto_pergunta": string | null,
        "confianca": "alta" | "media" | "baixa"
      }
    }`;

    const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" }
    });

    try {
        const analysis = JSON.parse(response.choices[0].message.content || "{}");
        console.log('Análise completa:', analysis);

        // Obter o paciente atual ou criar um novo
        const patient = MemoryStorage.getPacient(phone) || new Pacient();
        
        console.log('Paciente atual:', patient);

        // Atualizar informações do paciente
        if (analysis.informacoes) {
            const info = analysis.informacoes;
            if (info.nome && isValidName(info.nome)) patient.name = info.nome;
            if (info.idade && isValidAge(info.idade)) patient.age = info.idade;
            if (info.genero && isValidGender(info.genero)) patient.gender = info.genero;
            if (info.peso && isValidWeight(info.peso)) patient.weight = info.peso;
            if (info.altura && isValidHeight(info.altura)) patient.height = info.altura;
            if (info.nivel_atividade && isValidActivityLevel(info.nivel_atividade)) patient.activityLevel = info.nivel_atividade;
            if (info.objetivo && isValidGoal(info.objetivo)) patient.goal = info.objetivo;

            // Salvar paciente atualizado na memória
            MemoryStorage.savePacient(phone, patient);
            console.log('Paciente atualizado:', patient);
        }

        return {
            extracted: analysis.informacoes,
            hasQuestion: analysis.analise.tem_pergunta,
            questionContext: analysis.analise.contexto_pergunta
        };
    } catch (error) {
        console.error('Erro ao processar resposta:', error);
        return { extracted: null, hasQuestion: false, questionContext: null };
    }
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

async function generateNextQuestion(patient: Pacient, missingField: string, phone: string): Promise<string> {
    // Obter histórico recente para contexto
    const historico = MemoryStorage.getHistoricoDoDia(phone);
    const ultimasMensagens = historico.slice(-3); // Últimas 3 mensagens
    const contextoConversa = ultimasMensagens.map(msg => 
        `${msg.role === 'system' ? 'Nutri' : 'Paciente'}: ${msg.content}`
    ).join('\n');

    const prompt = `
    Como uma nutricionista empática e profissional, gere uma pergunta natural para obter o(a) ${missingField} do paciente.
    
    CONTEXTO ATUAL:
    ${JSON.stringify(patient, null, 2)}
    
    ÚLTIMAS MENSAGENS:
    ${contextoConversa}
    
    REGRAS IMPORTANTES:
    1. Seja natural e empática, mas mantenha o foco profissional
    2. Adapte o tom baseado no contexto da conversa
    3. Use o nome do paciente se disponível
    4. Inclua a unidade de medida quando necessário (kg, cm, etc)
    5. Use no máximo 2 emojis
    6. Mantenha a pergunta em UMA linha
    7. Se o paciente demonstrou dúvida ou hesitação, explique brevemente o porquê da pergunta
    
    E O MAIS IMPORTANTE: RESPONDA CONFORME O HUMOR DO PACIENTE, SE ELE FOR BRINCALHÃO, PODE SER MAIS INFORMAL E USAR GÍRIAS

    Se ele for mais formal, responda de forma mais profissional e direta.
    
    FORMATOS DE EXEMPLO:
    - Para gênero: "Você é homem ou mulher? (H/M)"
    - Para altura e peso juntos: "Qual sua altura (em cm) e peso (em kg)?"
    - Para nível de atividade física, inclua todas as opções:
      Sedentário (pouco ou nenhum exercício)
      Leve (exercício 1-3 vezes por semana)
      Moderado (exercício 3-5 vezes por semana)
      Ativo (exercício 6-7 vezes por semana)
      Muito ativo (exercícios intensos, 6-7 vezes por semana)

    EXEMPLOS DE TOM NATURAL:
    ❌ "Por favor, informe seu peso atual em quilogramas."
    ✅ "Me conta, quanto você tá pesando? 😊"
    
    ❌ "Qual é a sua altura em centímetros?"
    ✅ "E sua altura? (em cm) 📏"
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
    });

    return response.choices[0].message.content || `Por favor, me informe seu ${missingField}:`;
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
        model: "gpt-4.1",
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

async function classifyMessage(message: string, openai: OpenAI): Promise<'anamnese' | 'refeicao'> {
    const prompt = `
    Analise esta mensagem e determine se ela está relacionada a:
    1. Informações pessoais/anamnese (idade, peso, altura, sexo, nível de atividade, objetivo)
    2. Descrição de refeição/alimentação

    Mensagem: "${message}"

    Responda APENAS com uma palavra:
    - "anamnese" se for sobre informações pessoais
    - "refeicao" se for sobre alimentação
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [{ role: "system", content: prompt }],
        temperature: 0.1,
    });

    const classification = response.choices[0].message.content?.toLowerCase().trim();
    return classification === 'anamnese' ? 'anamnese' : 'refeicao';
}


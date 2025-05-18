import { Pacient } from "./Pacient";

export interface QuestionContext {
    question: string;
    type: 'nome' | 'gênero' | 'idade' | 'peso' | 'altura' | 'nivel_atividade' | 'objetivo';
    timestamp: number;
}

type MessageType = {
    role: 'system' | 'user';
    content: string;
    timestamp: number;
};

type HistoricoDia = {
    mensagens: MessageType[];
    refeicoes: string[];
    contextosUteis: {
        campo: string;
        pergunta: string;
        resposta: string;
    }[];
    contadorMensagens: number;
    primeiraInteracao: boolean;
};

type UserData = {
    name: string;
    phone: string;
    pacient: Pacient;
    historico: { [date: string]: HistoricoDia };
    messages: { [date: string]: string[] };
    firstMessage: boolean;
    primeiraInteracaoCompleta: boolean;
    lastQuestionContext?: QuestionContext;
};

const users: { [key: string]: UserData } = {};
const messageHistory: { [key: string]: string[] } = {};
const firstMessageFlags: { [key: string]: boolean } = {};
const questionContexts: { [key: string]: QuestionContext[] } = {};

function getHoje(): string {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function ensureUserExists(phone: string) {
    if (!users[phone]) {
        users[phone] = {
            name: '',
            phone,
            pacient: new Pacient(),
            historico: {},
            messages: {},
            firstMessage: true,
            primeiraInteracaoCompleta: false
        };
    }
    if (!users[phone].historico[getHoje()]) {
        users[phone].historico[getHoje()] = {
            mensagens: [],
            refeicoes: [],
            contextosUteis: [],
            contadorMensagens: 0,
            primeiraInteracao: true
        };
    }
}

export const MemoryStorage = {
    // User management
    getUser: (phone: string): UserData | null => users[phone] || null,
    
    createUser: (phone: string, name: string): UserData => {
        ensureUserExists(phone);
        users[phone].name = name;
        return users[phone];
    },

    updateUser: (phone: string, userData: Partial<UserData>) => {
        ensureUserExists(phone);
        users[phone] = { ...users[phone], ...userData };
        return users[phone];
    },

    // Pacient management
    getPacient: (phone: string): Pacient => {
        ensureUserExists(phone);
        return users[phone].pacient;
    },

    savePacient: (phone: string, pacient: Pacient) => {
        ensureUserExists(phone);
        users[phone].pacient = pacient;
    },

    // Meal management
    getRefeicoesDoDia: (phone: string, date = getHoje()): string[] => {
        ensureUserExists(phone);
        return users[phone].historico[date]?.refeicoes || [];
    },

    addRefeicao: (phone: string, refeicao: string, date = getHoje()) => {
        ensureUserExists(phone);
        if (!users[phone].historico[date]) {
            users[phone].historico[date] = { 
                mensagens: [], 
                refeicoes: [], 
                contextosUteis: [],
                contadorMensagens: 0,
                primeiraInteracao: true
            };
        }
        users[phone].historico[date].refeicoes.push(refeicao);
    },

    // Updated message history management
    getHistoricoDoDia: (phone: string, date = getHoje()): MessageType[] => {
        ensureUserExists(phone);
        return users[phone].historico[date]?.mensagens || [];
    },

    addMensagemAoHistorico: (phone: string, message: string, role: 'system' | 'user' = 'user', date = getHoje()) => {
        ensureUserExists(phone);
        const messageObj: MessageType = {
            role,
            content: message,
            timestamp: Date.now()
        };
        users[phone].historico[date].mensagens.push(messageObj);
        users[phone].historico[date].contadorMensagens++;
    },

    getUltimasMensagens: (phone: string, count: number = 2, date = getHoje()): MessageType[] => {
        ensureUserExists(phone);
        const mensagens = users[phone].historico[date]?.mensagens || [];
        return mensagens.slice(-count);
    },

    getUltimaPerguntaSistema: (phone: string, date = getHoje()): string | null => {
        ensureUserExists(phone);
        const mensagens = users[phone].historico[date]?.mensagens || [];
        for (let i = mensagens.length - 1; i >= 0; i--) {
            if (mensagens[i].role === 'system' && mensagens[i].content.includes('?')) {
                return mensagens[i].content;
            }
        }
        return null;
    },

    isConfirmationMessage: (message: string): boolean => {
        const confirmations = ['ok', 'sim', 'isso', 'isso mesmo', 'exato', 'exatamente', 'correto', 'é isso'];
        return confirmations.includes(message.toLowerCase().trim());
    },

    // Contextos úteis management
    addContextoUtil: (phone: string, campo: string, pergunta: string, resposta: string, date = getHoje()) => {
        ensureUserExists(phone);
        users[phone].historico[date].contextosUteis.push({ campo, pergunta, resposta });
    },

    getContextosUteis: (phone: string, date = getHoje()) => {
        ensureUserExists(phone);
        return users[phone].historico[date]?.contextosUteis || [];
    },

    // Message tracking
    isFirstMessage: (phone: string, date = getHoje()): boolean => {
        ensureUserExists(phone);
        return users[phone].historico[date].contadorMensagens === 1;
    },

    getMessageCount: (phone: string, date = getHoje()): number => {
        ensureUserExists(phone);
        return users[phone].historico[date].contadorMensagens;
    },

    isPrimeiraInteracao: (phone: string, date = getHoje()): boolean => {
        ensureUserExists(phone);
        return users[phone].historico[date].primeiraInteracao;
    },

    setPrimeiraInteracaoCompleta: (phone: string, date = getHoje()) => {
        ensureUserExists(phone);
        users[phone].historico[date].primeiraInteracao = false;
    },

    // Get all data
    getHistoricoCompleto: () => users,

    addQuestionContext: (phone: string, context: QuestionContext) => {
        if (!questionContexts[phone]) {
            questionContexts[phone] = [];
        }
        questionContexts[phone].push(context);
        // Keep only last 5 questions
        if (questionContexts[phone].length > 5) {
            questionContexts[phone].shift();
        }
    },

    getLastQuestionContext: (phone: string): QuestionContext | null => {
        if (!questionContexts[phone] || questionContexts[phone].length === 0) {
            return null;
        }
        return questionContexts[phone][questionContexts[phone].length - 1];
    },

    setPrimeiraInteracaoCompleta(phone: string) {
        const userData = this.getUser(phone);
        if (userData) {
            userData.primeiraInteracaoCompleta = true;
            this.updateUser(phone, userData);
        }
    },

    isPrimeiraInteracaoCompleta(phone: string): boolean {
        const userData = this.getUser(phone);
        return userData?.primeiraInteracaoCompleta || false;
    }
};

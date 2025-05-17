import { Pacient } from "./Pacient";

type HistoricoDia = {
    mensagens: string[];
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
};

const users: { [phone: string]: UserData } = {};

function getHoje(): string {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function ensureUserExists(phone: string) {
    if (!users[phone]) {
        users[phone] = {
            name: '',
            phone,
            pacient: new Pacient(),
            historico: {}
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
    
    createUser: (phone: string, name: string) => {
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

    // Message history management
    getHistoricoDoDia: (phone: string, date = getHoje()): string[] => {
        ensureUserExists(phone);
        return users[phone].historico[date]?.mensagens || [];
    },

    addMensagemAoHistorico: (phone: string, message: string, date = getHoje()) => {
        ensureUserExists(phone);
        users[phone].historico[date].mensagens.push(message);
        users[phone].historico[date].contadorMensagens++;
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
    getHistoricoCompleto: () => users
};

import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { routeMessage } from './services/messageRouter';

dotenv.config();
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function handleMessage(message: string, phone: string): Promise<string> {
    try {
        return await routeMessage(message, phone, openai);
    } catch (error) {
        console.error("Erro ao processar mensagem:", error);
        return "Desculpe, ocorreu um erro ao processar sua mensagem. Pode tentar novamente?";
    }
} 
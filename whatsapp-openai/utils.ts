import axios from 'axios';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import FormData from 'form-data';
import path from 'path';

dotenv.config();
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

interface AudioInput {
    audioUrl: string;
    mimeType?: string;
}

interface WhisperResponse {
    text: string;
}

export async function sendText(phone: string, text: string) {

    const instanceId = '3E1556F270CC30F46D860293E183E9A4';
    const token = '0BC69137B5B0A58869A55C9C';
    const clientToken = 'F19d4e7a06acd4ef08f0ea9c9473ddd79S'; // Replace with your actual Client-Token

    const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

    const data = {
        phone: phone,
        message: text
    };

    const config = {
        headers: {
            'Client-Token': clientToken,
            'Content-Type': 'application/json'
        }
    };

    try {
        const response = await axios.post(url, data, config);
        console.log('Message sent successfully');
        return response.data;
    } catch (error) {
        console.error('Error sending message:', error);
        throw error;
    }
}

export async function transcribeAudio(audio: AudioInput): Promise<string | null> {
    let tempFilePath: string | null = null;
    
    try {
        if (!audio || !audio.audioUrl) {
            console.error('URL do áudio não fornecida');
            return null;
        }

        // Baixar o arquivo de áudio da URL da ZAPI
        const audioResponse = await axios.get<ArrayBuffer>(audio.audioUrl, { 
            responseType: 'arraybuffer',
            headers: {
                'Accept': 'audio/*'
            }
        });

        // Criar um diretório temporário se não existir
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir);
        }

        // Criar um arquivo temporário com o áudio
        tempFilePath = path.join(tempDir, `audio-${Date.now()}.ogg`);
        const audioBuffer = Buffer.from(audioResponse.data);
        await fs.promises.writeFile(tempFilePath, audioBuffer);

        // Criar um FormData com o arquivo
        const form = new FormData();
        form.append('file', fs.createReadStream(tempFilePath), {
            filename: 'audio.ogg',
            contentType: audio.mimeType || 'audio/ogg'
        });
        form.append('model', 'whisper-1');
        form.append('language', 'pt');

        // Fazer a requisição diretamente para a API do OpenAI
        const response = await axios.post<WhisperResponse>(
            'https://api.openai.com/v1/audio/transcriptions', 
            form, 
            {
                headers: {
                    ...form.getHeaders(),
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                }
            }
        );

        return response.data.text;
    } catch (error) {
        console.error('Erro ao transcrever áudio:', error);
        return null;
    } finally {
        // Limpar o arquivo temporário se ele foi criado
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                await fs.promises.unlink(tempFilePath);
            } catch (unlinkError) {
                console.error('Erro ao remover arquivo temporário:', unlinkError);
            }
        }
    }
}

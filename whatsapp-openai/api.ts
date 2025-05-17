import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { sendText } from './utils';
import { algoritmoDeTratamentoDeMensagens, generateAnswer } from './services';
import { MemoryStorage } from './entities/memoryStorage';
import { Pacient } from './entities/Pacient';

const app = express();
const port = 3000;

// Middleware para CORS
app.use(cors());

// Middleware para processar JSON no body
app.use(bodyParser.json());
app.get('/', (req, res) => {
    res.send('API está funcionando');
});

const messageBuffer: { [phone: string]: string[] } = {};
const timeoutHandles: { [phone: string]: NodeJS.Timeout } = {};

// Rota POST que recebe dados e mostra no terminal
app.post('/log', async (req, res) => {
    console.log('Body recebido:', req.body);

    const { message, phone } = req.body;

    console.log(`message: ${message}, phone: ${phone}`);

    if (!message) {
        return res.status(400).json({ error: 'Nenhuma mensagem recebida' });
    }

// Adiciona a mensagem ao buffer do usuário
    if (!messageBuffer[phone]) {
        messageBuffer[phone] = [];
    }
    messageBuffer[phone].push(message);

    // Reinicia o timeout
    if (timeoutHandles[phone]) {
        clearTimeout(timeoutHandles[phone]);
    }

    // Cria novo timeout de 5 segundos
    timeoutHandles[phone] = setTimeout(async () => {
        const fullConversation = messageBuffer[phone].join('\n');

        console.log(`Enviando para OpenAI: \n${fullConversation}`);

        const answer = algoritmoDeTratamentoDeMensagens(fullConversation, phone);

        await sendText(phone, await answer);

        // Limpa os buffers
        delete messageBuffer[phone];
        delete timeoutHandles[phone];
    }, 5000);

    res.json({ message: 'Mensagem recebida com sucesso!' });
});

// Inicia o servidor
app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
    console.log('Aceitando conexões de qualquer origem');
});
function getMissingFields(patient: Pacient) {
    throw new Error('Function not implemented.');
}


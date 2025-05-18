import { OpenAI } from 'openai';
import { MemoryStorage } from '../entities/memoryStorage';
import { Pacient } from '../entities/Pacient';
import dotenv from 'dotenv';

export async function generateOpenAIResponse(openai: OpenAI, phone: string, basePrompt: string): Promise<string> {
    // Obter histórico de mensagens do dia
    const historicoDoDia = MemoryStorage.getHistoricoDoDia(phone);
    const ultimasMensagens = historicoDoDia.slice(-5); // Últimas 5 mensagens para contexto
    
    // Obter informações do paciente
    const patient = MemoryStorage.getPacient(phone);
    
    // Obter contextos úteis
    const contextosUteis = MemoryStorage.getContextosUteis(phone);
    const contextosFormatados = contextosUteis.map(ctx => 
        `Quando perguntei "${ctx.pergunta}", ${patient.name} respondeu "${ctx.resposta}" (${ctx.campo})`
    ).join('\n');

    // Obter contagem de mensagens
    const numeroMensagens = MemoryStorage.getMessageCount(phone);
    
    const systemPrompt = `${basePrompt}

Número de mensagens na conversa: ${numeroMensagens}
(Adapte seu estilo de acordo com a progressão da conversa)

Informações atuais do paciente:
${JSON.stringify(patient, null, 2)}

Contextos úteis da conversa:
${contextosFormatados}

Histórico recente da conversa:
${ultimasMensagens.join('\n')}
`;

    const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: historicoDoDia[historicoDoDia.length - 1] }
        ],
        temperature: 0.8,
    });

    return completion.choices[0].message.content || 'Desculpe, não consegui entender.';
}


import { OpenAI } from 'openai';
import { MemoryStorage } from '../entities/memoryStorage';
import { Pacient } from '../entities/Pacient';
import dotenv from 'dotenv';

function isAnamneseComplete(patient: Pacient): boolean {
    return Boolean(
        patient &&
        patient.name &&
        patient.age &&
        patient.gender &&
        patient.weight &&
        patient.height &&
        patient.activityLevel &&
        patient.goal
    );
}

export async function generateOpenAIResponse(openai: OpenAI, phone: string, basePrompt: string): Promise<string> {
    try {
        // Obter histórico de mensagens do dia
        const historicoDoDia = MemoryStorage.getHistoricoDoDia(phone);
        const ultimasMensagens = historicoDoDia.slice(-5); // Últimas 5 mensagens para contexto
        
        // Formatar histórico de mensagens para o prompt
        const historicoFormatado = ultimasMensagens.map(msg => 
            `${msg.role === 'system' ? 'Zubi' : 'Paciente'}: ${msg.content}`
        ).join('\n');
        
        // Obter informações do paciente
        const patient = MemoryStorage.getPacient(phone);
        
        // Determinar meta atual
        const metaAtual = isAnamneseComplete(patient) ? 'META 2 - DIÁRIO NUTRICIONAL' : 'META 1 - ANAMNESE NUTRICIONAL';
        
        // Obter contextos úteis
        const contextosUteis = MemoryStorage.getContextosUteis(phone);
        const contextosFormatados = contextosUteis.map(ctx => 
            `Quando perguntei "${ctx.pergunta}", ${patient?.name || 'paciente'} respondeu "${ctx.resposta}" (${ctx.campo})`
        ).join('\n');

        // Obter última pergunta do sistema
        const ultimaPergunta = MemoryStorage.getUltimaPerguntaSistema(phone);
        
        // Verificar se a última mensagem é uma confirmação
        const ultimaMensagem = historicoDoDia[historicoDoDia.length - 1];
        const isConfirmation = ultimaMensagem && MemoryStorage.isConfirmationMessage(ultimaMensagem.content);

        // Adicionar contexto especial para confirmações
        let contextoConfirmacao = '';
        if (isConfirmation && ultimaPergunta) {
            contextoConfirmacao = `
ATENÇÃO: A última mensagem do paciente ("${ultimaMensagem.content}") é uma confirmação para a pergunta:
"${ultimaPergunta}"
Considere isso ao formular sua resposta.`;
        }

        const systemPrompt = `${basePrompt}

META ATUAL: ${metaAtual}
STATUS DA ANAMNESE: ${isAnamneseComplete(patient) ? 'COMPLETA' : 'INCOMPLETA'}

Número de mensagens na conversa: ${historicoDoDia.length}
(Adapte seu estilo de acordo com a progressão da conversa)

Informações atuais do paciente:
${JSON.stringify(patient, null, 2)}

Contextos úteis da conversa:
${contextosFormatados}

Histórico recente da conversa:
${historicoFormatado}
${contextoConfirmacao}

LEMBRE-SE: ${isAnamneseComplete(patient) 
    ? 'Foque em registrar as refeições e fornecer feedback sobre macros e calorias.' 
    : 'Foque em coletar as informações faltantes da anamnese.'}

IMPORTANTE:
1. Se o paciente responder apenas com confirmação (ok, sim, etc), continue o fluxo baseado na última pergunta
2. Se a resposta não fizer sentido para a pergunta atual, peça gentilmente para reformular
3. Mantenha o foco na meta atual e evite distrações
`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: ultimaMensagem.content }
            ],
            temperature: 0.8,
        });

        const response = completion.choices[0].message.content || 'Desculpe, não consegui entender.';
        return response;
    } catch (error) {
        console.error('Erro ao gerar resposta:', error);
        return 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.';
    }
}


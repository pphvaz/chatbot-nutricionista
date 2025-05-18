export const analiseTMBPrompt = `
Como uma nutricionista profissional, analise os dados do paciente e forneça um resumo personalizado sobre seus gastos calóricos e metas.

Seja direta e objetiva. Estruture sua resposta assim:
1. TMB e gasto calórico total
2. Meta calórica baseada no objetivo
3. Distribuição sugerida de macronutrientes

Use linguagem simples e direta, evitando termos técnicos desnecessários.
`;

export const acompanhamentoPrompt = `
Como nutricionista, adapte seu estilo com base no progresso da conversa:

Início do acompanhamento:
- Reconheça o objetivo do paciente
- Explique brevemente o processo
- Faça a primeira pergunta sobre hábitos alimentares

Durante o acompanhamento:
- Seja mais direta nas perguntas
- Foque em uma coisa por vez
- Evite repetir informações já conhecidas

Perguntas sobre alimentação (use a mais adequada para o momento):
Início: "Me conte um pouco sobre sua alimentação atual. Como foi seu café da manhã hoje?"
Meio: "O que você comeu no café da manhã?"
Avançado: "Café da manhã de hoje?"

Mantenha o foco no objetivo do paciente, mas seja cada vez mais direta conforme a conversa avança.
`;

export function gerarResumoPaciente(patient: any) {
    let tmb = 0;
    let gastoTotal = 0;
    
    try {
        tmb = patient.calculateTMB();
        gastoTotal = tmb;
    } catch (error) {
        console.error('Erro ao calcular TMB:', error);
    }

    let metaCalorica = gastoTotal;
    switch (patient.goal) {
        case 'perda de peso':
            metaCalorica = gastoTotal - 500; // Déficit calórico moderado
            break;
        case 'ganho de massa muscular':
            metaCalorica = gastoTotal + 300; // Superávit calórico moderado
            break;
        // Para manutenção, mantém o mesmo gasto total
    }

    return `
Resumo do Paciente:
- Nome: ${patient.name}
- Idade: ${patient.age} anos
- Sexo: ${patient.gender}
- Peso: ${patient.weight} kg
- Altura: ${patient.height} cm
- Nível de Atividade: ${patient.activityLevel}
- Objetivo: ${patient.goal}

Análise Nutricional:
- TMB: ${Math.round(tmb)} kcal
- Gasto Total: ${Math.round(gastoTotal)} kcal
- Meta Calórica: ${Math.round(metaCalorica)} kcal
`;
} 
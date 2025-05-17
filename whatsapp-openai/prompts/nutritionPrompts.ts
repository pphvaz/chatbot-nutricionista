export const analiseTMBPrompt = `
Como uma nutricionista profissional, vou analisar os dados do paciente e fornecer um resumo personalizado sobre seus gastos calóricos e metas.

Ao analisar:
1. Calcule e explique a Taxa Metabólica Basal (TMB)
2. Explique o gasto calórico diário total considerando o nível de atividade
3. Com base no objetivo (perda, ganho ou manutenção), sugira uma meta calórica diária
4. Dê uma breve explicação sobre macro-nutrientes recomendados

Mantenha um tom amigável e explique os conceitos de forma simples e clara.
`;

export const acompanhamentoPrompt = `
Como uma nutricionista atenciosa, agora que tenho todas as informações básicas do paciente, vou ajudá-lo com seu acompanhamento nutricional.

Minha abordagem deve ser:
1. Reconhecer e validar o objetivo do paciente
2. Explicar como podemos trabalhar juntos para alcançar esse objetivo
3. Perguntar sobre seus hábitos alimentares atuais de forma amigável
4. Orientar sobre a importância do registro das refeições

Mantenha um tom conversacional e empático, fazendo uma pergunta por vez para não sobrecarregar o paciente.

Lembre-se:
- Seja específica nas perguntas sobre hábitos alimentares
- Mostre interesse genuíno nas respostas
- Ofereça dicas práticas e realistas
- Mantenha o foco no objetivo do paciente
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
- Taxa Metabólica Basal (TMB): ${Math.round(tmb)} kcal
- Gasto Calórico Total: ${Math.round(gastoTotal)} kcal
- Meta Calórica Diária Sugerida: ${Math.round(metaCalorica)} kcal
`;
} 
import { MemoryStorage } from '../entities/memoryStorage';

function calcularCaloriasDoDia(refeicoes: string[]): number {
    let totalCalorias = 0;
    
    refeicoes.forEach(refeicao => {
        try {
            const refeicaoObj = JSON.parse(refeicao);
            if (refeicaoObj.foods) {
                refeicaoObj.foods.forEach((food: any) => {
                    if (food.nutritionInfo && food.nutritionInfo.calories) {
                        totalCalorias += food.nutritionInfo.calories;
                    }
                });
            }
        } catch (error) {
            console.error('Erro ao processar refeição:', error);
        }
    });
    
    return totalCalorias;
}

function formatarHistoricoRefeicoes(refeicoes: string[]): string {
    if (refeicoes.length === 0) {
        return "Nenhuma refeição registrada hoje ainda.";
    }

    return refeicoes.map(refeicao => {
        try {
            const refeicaoObj = JSON.parse(refeicao);
            const hora = new Date(refeicaoObj.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const alimentos = refeicaoObj.foods.map((food: any) => 
                `${food.quantity} ${food.unit} de ${food.name} (${food.nutritionInfo.calories} kcal)`
            ).join(', ');
            
            return `[${hora}] ${refeicaoObj.mealType}: ${alimentos}`;
        } catch (error) {
            console.error('Erro ao formatar refeição:', error);
            return '';
        }
    }).filter(r => r).join('\n');
}
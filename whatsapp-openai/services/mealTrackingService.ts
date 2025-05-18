import { MemoryStorage } from '../entities/memoryStorage';
import { OpenAI } from 'openai';

interface MealInfo {
    calories: number;
    protein: number;
    carbs: number;
    fats: number;
    description: string;
}

interface DailyProgress {
    totalCalories: number;
    totalProtein: number;
    totalCarbs: number;
    totalFats: number;
    goalCalories: number;
    meals: MealInfo[];
}

export async function processNewMeal(message: string, phone: string, openai: OpenAI): Promise<string> {
    const prompt = `
    Você é um nutricionista responsável por registrar refeições de um diário alimentar.

    REGRAS IMPORTANTES:
    1. Calcule as calorias e macronutrientes (proteínas, carboidratos, gorduras) de forma REALISTA e PROPORCIONAL à quantidade informada.
    2. Se o paciente relatar uma quantidade MUITO GRANDE (ex: 10 pizzas, 5kg de arroz), os valores devem ser ALTOS e compatíveis com a porção.
    3. Nunca subestime calorias: 1 pizza inteira tem cerca de 1500-2000 kcal, 1 maçã média tem cerca de 50 kcal, etc.
    4. Se a quantidade for absurda, registre os valores proporcionais, mas pode sugerir moderação de forma educada.
    5. Sempre some os valores de cada unidade/porção.

    EXEMPLOS:
    - "Comi 10 pizzas inteiras" → Calorias: 15.000-20.000 kcal (não 20 kcal!)
    - "Comi 10 maçãs" → Calorias: 500 kcal (não 20 kcal!)
    - "Comi 2 fatias de pão" → Calorias: 140 kcal

    Analise esta refeição e forneça as informações nutricionais aproximadas:
    "${message}"

    Responda EXATAMENTE neste formato:
    CALORIAS: [número]
    PROTEINAS: [número]
    CARBOIDRATOS: [número]
    GORDURAS: [número]
    DESCRICAO: [texto]
    `;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4.1",
            messages: [{ role: "system", content: prompt }],
            temperature: 0.1
        });

        const content = response.choices[0].message.content || "";
        
        // Parse the response more safely
        const lines = content.split('\n').filter(line => line.trim()); // Remove empty lines
        const parsedData: Record<string, string> = {};
        
        // Parse each line into key-value pairs
        lines.forEach(line => {
            const [key, ...valueParts] = line.split(':');
            if (key && valueParts.length > 0) {
                parsedData[key.trim().toLowerCase()] = valueParts.join(':').trim();
            }
        });

        // Create meal info with safer parsing
        const mealInfo: MealInfo = {
            calories: parseFloat(parsedData['calorias']) || 0,
            protein: parseFloat(parsedData['proteinas']) || 0,
            carbs: parseFloat(parsedData['carboidratos']) || 0,
            fats: parseFloat(parsedData['gorduras']) || 0,
            description: parsedData['descricao'] || "refeição"
        };
        
        // Validate the parsed data
        if (mealInfo.calories === 0 && mealInfo.protein === 0 && mealInfo.carbs === 0 && mealInfo.fats === 0) {
            throw new Error('Não foi possível extrair informações nutricionais válidas');
        }
        
        // Salvar a refeição no histórico
        const mealData = JSON.stringify({
            ...mealInfo,
            timestamp: Date.now()
        });
        MemoryStorage.addRefeicao(phone, mealData);

        // Calcular progresso diário
        const progress = calculateDailyProgress(phone);
        
        // Gerar resposta simplificada
        return formatMealResponse(mealInfo, progress, phone);
    } catch (error) {
        console.error('Erro ao processar refeição:', error);
        return "Desculpe, não consegui processar sua refeição. Pode descrever novamente? 😅";
    }
}

function calculateDailyProgress(phone: string): DailyProgress {
    const patient = MemoryStorage.getPacient(phone);
    const refeicoes = MemoryStorage.getRefeicoesDoDia(phone);
    const progress: DailyProgress = {
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFats: 0,
        goalCalories: patient?.calculateTMB() || 2000, // Use TMB do paciente
        meals: []
    };

    refeicoes.forEach(refeicao => {
        try {
            const meal = JSON.parse(refeicao);
            progress.totalCalories += meal.calories || 0;
            progress.totalProtein += meal.protein || 0;
            progress.totalCarbs += meal.carbs || 0;
            progress.totalFats += meal.fats || 0;
            progress.meals.push(meal);
        } catch (error) {
            console.error('Erro ao processar refeição do histórico:', error);
        }
    });

    return progress;
}

function formatMealResponse(meal: MealInfo, progress: DailyProgress, phone: string): string {
    const patient = MemoryStorage.getPacient(phone);
    const remainingCals = progress.goalCalories - progress.totalCalories;
    const percentProgress = Math.round((progress.totalCalories / progress.goalCalories) * 100);

    let suggestion = '';
    if (patient?.goal) {
        if (patient.goal === 'perda de peso') {
            if (remainingCals < progress.goalCalories * 0.3) { // Se já consumiu mais de 70% das calorias
                suggestion = '\n💡 Dica: Para seu objetivo de perda de peso, considere opções leves para as próximas refeições como saladas, proteínas magras ou sopas.';
            }
        } else if (patient.goal === 'ganho de massa muscular' && patient.weight) {
            if (progress.totalProtein < patient.weight * 0.8) { // Se ainda não atingiu 80% da meta de proteína
                suggestion = '\n💡 Dica: Para ganho de massa, você ainda precisa aumentar sua ingestão de proteínas. Que tal frango, ovo ou whey protein?';
            }
        }
    }

    let statusLine = '';
    if (remainingCals >= 0) {
        statusLine = `⚡ Faltam: ${remainingCals} kcal`;
    } else {
        statusLine = `⚠️ Você ultrapassou sua meta em ${Math.abs(remainingCals)} kcal!`;
    }

    return `✅ Refeição registrada: ${meal.calories} kcal (P: ${meal.protein}g | C: ${meal.carbs}g | G: ${meal.fats}g)
📊 Progresso: ${progress.totalCalories}/${progress.goalCalories} kcal (${percentProgress}%)
${statusLine}${suggestion}`;
}

export function getDailySummary(phone: string): string {
    const progress = calculateDailyProgress(phone);
    const percentProgress = Math.round((progress.totalCalories / progress.goalCalories) * 100);

    return `📊 Resumo do dia:
Total: ${progress.totalCalories}/${progress.goalCalories} kcal (${percentProgress}%)
Macros: P: ${progress.totalProtein}g | C: ${progress.totalCarbs}g | G: ${progress.totalFats}g`;
} 
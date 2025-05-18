import { OpenAI } from 'openai';
import { MemoryStorage } from '../entities/memoryStorage';

interface NutritionInfo {
    carbs: number;
    protein: number;
    fat: number;
    calories: number;
}

interface FoodItem {
    name: string;
    quantity: number;
    unit: string;
    nutritionInfo: NutritionInfo;
}

interface MealEntry {
    timestamp: Date;
    foods: FoodItem[];
    notes?: string;
}

const MEAL_ANALYSIS_PROMPT = `Analise os alimentos mencionados na mensagem. Seja flexível com medidas aproximadas (ex: "prato cheio", "colher cheia", "pedaço grande").

MENSAGEM: "{message}"

Extraia os alimentos e tente inferir quantidades baseado no contexto. Se uma quantidade específica não for mencionada, use aproximações razoáveis baseadas em porções comuns.

Formato da resposta:

ALIMENTOS:
1. Nome: [nome]
   Quantidade: [número] [unidade]
   Contexto: [menção original no texto]
   Nutrientes:
   - Carboidratos: [número]g
   - Proteínas: [número]g
   - Gorduras: [número]g
   - Calorias: [número]

2. [próximo alimento...]`;

export async function processNutritionJournal(message: string, phone: string, openai: OpenAI): Promise<string> {
    try {
        const patient = MemoryStorage.getPacient(phone);
        if (!patient || !isAnamnesisComplete(patient)) {
            return `Fala ${patient?.name || ''}! Preciso completar sua análise antes de começar a anotar as refeições.`;
        }

        // Se for uma saudação simples
        if (message.toLowerCase().match(/^(oi|olá|bom dia|boa tarde|boa noite|hey|e ai|eai)$/)) {
            return `Fala ${patient.name}!\nPode me dizer sua refeição que eu anoto aqui pra você.`;
        }

        // Analisar a mensagem com GPT
        const analysis = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { 
                    role: "system", 
                    content: MEAL_ANALYSIS_PROMPT.replace('{message}', message)
                }
            ],
            temperature: 0.1,
        });

        const analysisContent = analysis.choices[0].message.content;
        if (!analysisContent) {
            return "Não entendi bem. Pode me explicar melhor o que você comeu?";
        }

        // Processar a resposta
        const mealEntry = parseMealAnalysis(analysisContent);
        if (!mealEntry || mealEntry.foods.length === 0) {
            return "Não consegui identificar os alimentos. Pode detalhar um pouco mais?";
        }

        // Salvar no histórico
        MemoryStorage.addRefeicao(phone, JSON.stringify(mealEntry));

        // Gerar resposta simples
        return generateFriendlyResponse(mealEntry, phone);
    } catch (error) {
        console.error("Erro ao processar diário nutricional:", error);
        return "Ops, tive um problema aqui. Pode repetir?";
    }
}

function isAnamnesisComplete(patient: any): boolean {
    return patient.name && 
           patient.age && 
           patient.gender && 
           patient.weight && 
           patient.height && 
           patient.activityLevel && 
           patient.goal;
}

function parseMealAnalysis(content: string): MealEntry | null {
    try {
        const lines = content.split('\n');
        const mealEntry: MealEntry = {
            timestamp: new Date(),
            foods: []
        };

        let currentFood: Partial<FoodItem> | null = null;
        let currentNutrients: Partial<NutritionInfo> | null = null;

        for (const line of lines) {
            const trimmedLine = line.trim();

            // Novo alimento
            if (trimmedLine.startsWith('Nome:')) {
                if (currentFood && currentNutrients) {
                    currentFood.nutritionInfo = currentNutrients as NutritionInfo;
                    mealEntry.foods.push(currentFood as FoodItem);
                }
                currentFood = {
                    name: trimmedLine.split(':')[1].trim(),
                    quantity: 0,
                    unit: '',
                    nutritionInfo: { carbs: 0, protein: 0, fat: 0, calories: 0 }
                };
                currentNutrients = { carbs: 0, protein: 0, fat: 0, calories: 0 };
                continue;
            }

            // Quantidade e unidade
            if (trimmedLine.startsWith('Quantidade:') && currentFood) {
                const [quantity, ...unitParts] = trimmedLine.split(':')[1].trim().split(' ');
                currentFood.quantity = parseFloat(quantity);
                currentFood.unit = unitParts.join(' ');
            }

            // Nutrientes
            if (currentNutrients) {
                if (trimmedLine.includes('Carboidratos:')) {
                    currentNutrients.carbs = parseFloat(trimmedLine.split(':')[1].trim());
                }
                if (trimmedLine.includes('Proteínas:')) {
                    currentNutrients.protein = parseFloat(trimmedLine.split(':')[1].trim());
                }
                if (trimmedLine.includes('Gorduras:')) {
                    currentNutrients.fat = parseFloat(trimmedLine.split(':')[1].trim());
                }
                if (trimmedLine.includes('Calorias:')) {
                    currentNutrients.calories = parseFloat(trimmedLine.split(':')[1].trim());
                }
            }
        }

        // Adicionar último alimento se existir
        if (currentFood && currentNutrients) {
            currentFood.nutritionInfo = currentNutrients as NutritionInfo;
            mealEntry.foods.push(currentFood as FoodItem);
        }

        return mealEntry;
    } catch (error) {
        console.error("Erro ao parsear análise da refeição:", error);
        return null;
    }
}

function generateFriendlyResponse(mealEntry: MealEntry, phone: string): string {
    const totalNutrients = mealEntry.foods.reduce(
        (acc, food) => {
            acc.carbs += food.nutritionInfo.carbs;
            acc.protein += food.nutritionInfo.protein;
            acc.fat += food.nutritionInfo.fat;
            acc.calories += food.nutritionInfo.calories;
            return acc;
        },
        { carbs: 0, protein: 0, fat: 0, calories: 0 }
    );

    const dailyTotals = MemoryStorage.getRefeicoesDoDia(phone).reduce(
        (acc, refeicaoStr) => {
            try {
                const refeicao = JSON.parse(refeicaoStr) as MealEntry;
                refeicao.foods.forEach(food => {
                    acc.carbs += food.nutritionInfo.carbs;
                    acc.protein += food.nutritionInfo.protein;
                    acc.fat += food.nutritionInfo.fat;
                    acc.calories += food.nutritionInfo.calories;
                });
            } catch (error) {
                console.error("Erro ao processar refeição do histórico:", error);
            }
            return acc;
        },
        { carbs: 0, protein: 0, fat: 0, calories: 0 }
    );

    // Análise dos macros em relação ao objetivo
    const patient = MemoryStorage.getPacient(phone);
    let macroAnalysis = '';
    
    if (patient?.goal && patient.weight) {
        const proteinPerKg = dailyTotals.protein / patient.weight;
        const carbsPerKg = dailyTotals.carbs / patient.weight;
        
        if (patient.goal === 'ganho de massa muscular') {
            if (proteinPerKg < 2.0) macroAnalysis = '\n💡 Dica: Considere aumentar a ingestão de proteína para atingir seu objetivo de ganho de massa.';
            else if (carbsPerKg < 4.0) macroAnalysis = '\n💡 Dica: Para ganho de massa, você pode aumentar o consumo de carboidratos.';
        } else if (patient.goal === 'perda de peso') {
            if (dailyTotals.calories > (patient.weight * 30)) macroAnalysis = '\n💡 Dica: Para perda de peso, considere reduzir um pouco as calorias totais.';
        }
    }

    return `Ok, anotado! 

TOTAL DO DIA:
• ${dailyTotals.calories.toFixed(0)} kcal
• Carboidratos: ${dailyTotals.carbs.toFixed(1)}g
• Proteínas: ${dailyTotals.protein.toFixed(1)}g
• Gorduras: ${dailyTotals.fat.toFixed(1)}g${macroAnalysis}`;
} 
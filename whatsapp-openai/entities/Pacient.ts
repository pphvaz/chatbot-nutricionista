export class Pacient {
    constructor(
        public name?: string,
        public age?: number,
        public gender?: 'masculino' | 'feminino',
        public weight?: number,
        public height?: number,
        public activityLevel?: 'sedentario' | 'leve' | 'moderado' | 'ativo' | 'muito ativo',
        public goal?: 'perda de peso' | 'ganho de massa muscular' | 'manutenção',
    ) {}

    public calculateIMC(): number {
        if (this.weight === undefined || this.height === undefined) {
            throw new Error('Peso e altura são obrigatórios para calcular o IMC.');
        }
        const heightInMeters = this.height / 100;
        return this.weight / (heightInMeters * heightInMeters);
    }
    
    public calculateTMB(): number {
        if (
            this.weight === undefined ||
            this.height === undefined ||
            this.age === undefined ||
            this.gender === undefined ||
            this.activityLevel === undefined ||
            this.goal === undefined
        ) {
            throw new Error('Todos os campos são obrigatórios para calcular a TMB.');
        }

        // Calcular TMB base usando a fórmula de Harris-Benedict
        let tmb: number;
        if (this.gender === 'masculino') {
            tmb = 10 * this.weight + 6.25 * this.height - 5 * this.age + 5;
        } else {
            tmb = 10 * this.weight + 6.25 * this.height - 5 * this.age - 161;
        }

        // Aplicar fator de atividade
        let tmbWithActivity: number;
        switch (this.activityLevel) {
            case 'sedentario':
                tmbWithActivity = tmb * 1.2;
                break;
            case 'leve':
                tmbWithActivity = tmb * 1.375;
                break;
            case 'moderado':
                tmbWithActivity = tmb * 1.55;
                break;
            case 'ativo':
                tmbWithActivity = tmb * 1.725;
                break;
            case 'muito ativo':
                tmbWithActivity = tmb * 1.9;
                break;
            default:
                tmbWithActivity = tmb;
        }

        // Ajustar com base no objetivo
        switch (this.goal) {
            case 'perda de peso':
                return Math.round(tmbWithActivity * 0.85); // Déficit de 15%
            case 'ganho de massa muscular':
                return Math.round(tmbWithActivity * 1.15); // Superávit de 15%
            case 'manutenção':
            default:
                return Math.round(tmbWithActivity);
        }
    }
} 
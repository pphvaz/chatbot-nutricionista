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
            this.activityLevel === undefined
        ) {
            throw new Error('Todos os campos são obrigatórios para calcular a TMB.');
        }
        let tmb: number;
        if (this.gender === 'masculino') {
            tmb = 10 * this.weight + 6.25 * this.height - 5 * this.age + 5;
        } else {
            tmb = 10 * this.weight + 6.25 * this.height - 5 * this.age - 161;
        }
        switch (this.activityLevel) {
            case 'sedentario':
                return tmb * 1.2;
            case 'leve':
                return tmb * 1.375;
            case 'moderado':
                return tmb * 1.55;
            case 'ativo':
                return tmb * 1.725;
            case 'muito ativo':
                return tmb * 1.9;
            default:
                return tmb;
        }
    }

} 
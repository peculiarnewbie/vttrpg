declare module "@3d-dice/dice-box-threejs" {
  export type DiceBoxConfig = {
    assetPath?: string;
    sounds?: boolean;
    volume?: number;
    shadows?: boolean;
    theme_surface?: string;
    theme_colorset?: string;
    theme_texture?: string;
    theme_material?: string;
    gravity_multiplier?: number;
    light_intensity?: number;
    baseScale?: number;
    strength?: number;
    delay?: number;
    onRollComplete?: (results: unknown) => void;
  };

  export type DiceResultSet = {
    rolls: { value: number; sides: number }[];
  };

  export default class DiceBox {
    constructor(selector: string, config?: DiceBoxConfig);
    initialize(): Promise<void>;
    roll(notation: string): Promise<DiceResultSet[]>;
    add(notation: string): Promise<DiceResultSet[]>;
    clear(): void;
    setDimensions(dimensions: { width: number; height: number }): void;
    updateConfig(config: DiceBoxConfig): void;
  }
}

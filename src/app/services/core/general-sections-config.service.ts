import { Injectable } from '@angular/core';

export interface GeneralSectionsConfig {
  repositoryLink: string;
  teamContent: string;
}

@Injectable({
  providedIn: 'root'
})
export class GeneralSectionsConfigService {
  private readonly STORAGE_KEY = 'general_sections_config';

  private readonly defaults: GeneralSectionsConfig = {
    repositoryLink: 'https://dev.azure.com/YOUR_ORG/YOUR_PROJECT/_git/NU0139001_SAF_MR_Test - Repos (visualstudio.com)',
    teamContent: 'Dueño del Producto – Bancolombia: Diego Fernando Giraldo Hincapie\nAnalista de Desarrollo – Pragma: Eddy Johana Cristancho\nAnalista de Desarrollo – Luis Alfredo Chuscano Remolina\nAnalista de Desarrollo - Kevin David Cuadros Estupinan\nAnalista de Pruebas – TCS: Gabriel Ernesto Montoya Henao\nAnalista de Pruebas – TCS: Andrés Antonio Bernal Padilla'
  };

  getDefaults(): GeneralSectionsConfig {
    return { ...this.defaults };
  }

  getConfig(): GeneralSectionsConfig {
    if (typeof window === 'undefined' || !window.localStorage) {
      return this.getDefaults();
    }

    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) {
        return this.getDefaults();
      }

      const parsed = JSON.parse(raw) as Partial<GeneralSectionsConfig>;
      return {
        repositoryLink: (parsed.repositoryLink || '').trim() || this.defaults.repositoryLink,
        teamContent: (parsed.teamContent || '').trim() || this.defaults.teamContent
      };
    } catch {
      return this.getDefaults();
    }
  }

  saveConfig(config: Partial<GeneralSectionsConfig>): GeneralSectionsConfig {
    const current = this.getConfig();
    const updated: GeneralSectionsConfig = {
      repositoryLink: (config.repositoryLink ?? current.repositoryLink).trim() || this.defaults.repositoryLink,
      teamContent: (config.teamContent ?? current.teamContent).trim() || this.defaults.teamContent
    };

    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updated));
    }

    return updated;
  }
}

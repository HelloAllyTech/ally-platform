import { Injectable, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PromptsService } from './prompt.service';
import { formatLabel } from '../util/format-label.util';
import { LoggerService } from 'src/logger/logger.service';
import { parseVariablesFromPrompt } from '../util/parse-variables.util';
import { PromptContract } from '../entity/prompt.entity';
import { PROMPT_CONTRACTS, toStoreContract } from '../contracts';

const PROMPTS_DIR = 'src/prompts';
@Injectable()
export class PromptsSyncService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(PromptsSyncService.name);

  constructor(private readonly promptsService: PromptsService) {}

  async onModuleInit(): Promise<void> {
    // Run sync in background to avoid blocking app startup (e.g. when DB is not ready yet)
    this.syncFromFolder().catch((err) =>
      this.logger.error(`Prompts sync failed: ${err?.message || err}`),
    );
  }

  /**
   * Derive name and description from promptCode via formatLabel.
   * For subdir_filename codes, formats as "Subdir: Filename" / "Subdir prompt — Filename".
   */
  private getNameAndDescription(
    promptCode: string,
    hadSubdir: boolean,
  ): { name: string; description: string } {
    if (hadSubdir && promptCode.includes('_')) {
      const lastUnderscore = promptCode.lastIndexOf('_');
      const subdirPart = promptCode.slice(0, lastUnderscore);
      const filenamePart = promptCode.slice(lastUnderscore + 1);
      return {
        name: `${formatLabel(subdirPart)}: ${formatLabel(filenamePart)}`,
        description: `${formatLabel(subdirPart)} prompt — ${formatLabel(filenamePart)}`,
      };
    }
    const formatted = formatLabel(promptCode);
    return { name: formatted, description: formatted };
  }

  private getCategoryFromRelativePath(relPath: string): string | undefined {
    const [topLevelFolder] = relPath.split(/[/\\]/);
    if (!topLevelFolder || topLevelFolder === relPath) {
      return undefined;
    }
    return formatLabel(topLevelFolder);
  }

  /**
   * Scan prompts folder and sync to DB. Add-only for new; update defaultPrompt for existing.
   */
  async syncFromFolder(): Promise<{ added: number; updated: number }> {
    const promptsDir = path.join(process.cwd(), PROMPTS_DIR);
    if (!fs.existsSync(promptsDir)) {
      this.logger.info(
        `Prompts folder not found at ${promptsDir}, skipping sync`,
      );
      return { added: 0, updated: 0 };
    }

    const items: {
      promptCode: string;
      name: string;
      description: string;
      category?: string;
      prompt: string;
      // Local sync auto-parses placeholders into bare names. Remote
      // sync payloads from ai-learn may include the richer
      // `{ name, label?, required? }` shape; the service accepts both.
      availableVariables: (
        | string
        | { name: string; label?: string; required?: boolean }
      )[];
      runtimes?: string[];
      defaultProvider?: string;
      defaultModel?: string;
      contract?: PromptContract;
    }[] = [];

    const scanDir = (dir: string, baseDir: string = dir): void => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath, baseDir);
        } else if (entry.isFile() && entry.name.endsWith('.txt')) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const relPath = path.relative(baseDir, fullPath);
          const pathWithoutExt = relPath.replace(/\.txt$/, '');
          const promptCode = pathWithoutExt
            .replace(/\//g, '_')
            .replace(/\\/g, '_');
          const hadSubdir = /[/\\]/.test(pathWithoutExt);
          let { name, description } = this.getNameAndDescription(
            promptCode,
            hadSubdir,
          );
          let category = this.getCategoryFromRelativePath(relPath);
          // Display details come from the prompt's contract (prompt-contracts.ts);
          // the path-derived values fill whatever it leaves out.
          const definition = PROMPT_CONTRACTS[promptCode];
          const details = definition?.details ?? {};
          if (details.name) name = details.name;
          if (details.description) description = details.description;
          if (details.category) category = details.category;
          items.push({
            promptCode,
            name,
            description,
            category,
            prompt: content.trim(),
            availableVariables: parseVariablesFromPrompt(content),
            runtimes: details.runtimes,
            defaultProvider: details.defaultModel?.provider,
            defaultModel: details.defaultModel?.model,
            // The code's contract. The store refuses a version that breaks it.
            ...(definition ? { contract: toStoreContract(definition) } : {}),
          });
        }
      }
    };

    scanDir(promptsDir);

    if (items.length === 0) {
      this.logger.info(`No .txt files found in ${promptsDir}`);
      return { added: 0, updated: 0 };
    }

    const result = await this.promptsService.syncPrompts({ prompts: items });
    this.logger.info(
      `Prompts sync: ${result.added} added, ${result.updated} contract/metadata updated`,
    );
    return result;
  }
}

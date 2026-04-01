import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

export interface ProviderConfig {
  apiKey: string;
  model: string;
}

export interface Config {
  provider: string;
  providers: {
    groq?: ProviderConfig;
    openai?: ProviderConfig;
    gemini?: ProviderConfig;
    [key: string]: ProviderConfig | undefined;
  };
}

export interface ResolvedConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseURL: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.fcc');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history');

const PROVIDER_DEFAULTS: Record<string, { model: string; baseURL: string }> = {
  groq: {
    model: 'llama-3.3-70b-versatile',
    baseURL: 'https://api.groq.com/openai/v1',
  },
  openai: {
    model: 'gpt-4o',
    baseURL: 'https://api.openai.com/v1',
  },
  gemini: {
    model: 'gemini-2.0-flash',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  },
};

export function getDefaultModel(provider: string): string {
  return PROVIDER_DEFAULTS[provider]?.model ?? 'gpt-4o';
}

export function getBaseURL(provider: string): string {
  return PROVIDER_DEFAULTS[provider]?.baseURL ?? 'https://api.openai.com/v1';
}

export function getHistoryFile(): string {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  return HISTORY_FILE;
}

export function loadConfig(): Config | null {
  // Check environment variables first
  const envProvider = process.env.FCC_PROVIDER;
  const envGroq = process.env.GROQ_API_KEY;
  const envOpenAI = process.env.OPENAI_API_KEY;
  const envGemini = process.env.GEMINI_API_KEY;

  // Load from file
  let fileConfig: Config | null = null;
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
    fileConfig = JSON.parse(data);
  } catch {
    // Config file doesn't exist yet
  }

  // Build merged config (env vars take precedence)
  const config: Config = {
    provider: envProvider ?? fileConfig?.provider ?? 'groq',
    providers: { ...fileConfig?.providers },
  };

  if (envGroq) {
    config.providers.groq = {
      apiKey: envGroq,
      model: config.providers.groq?.model ?? getDefaultModel('groq'),
    };
  }
  if (envOpenAI) {
    config.providers.openai = {
      apiKey: envOpenAI,
      model: config.providers.openai?.model ?? getDefaultModel('openai'),
    };
  }
  if (envGemini) {
    config.providers.gemini = {
      apiKey: envGemini,
      model: config.providers.gemini?.model ?? getDefaultModel('gemini'),
    };
  }

  // Check if the configured provider has a key
  if (config.providers[config.provider]?.apiKey) {
    return config;
  }

  // Fall back to any provider that has a key
  for (const [name, cfg] of Object.entries(config.providers)) {
    if (cfg?.apiKey) {
      config.provider = name;
      return config;
    }
  }

  return null; // No API key found anywhere
}

export function resolveConfig(
  config: Config,
  providerOverride?: string,
  modelOverride?: string,
): ResolvedConfig {
  const provider = providerOverride ?? config.provider;
  const providerCfg = config.providers[provider];

  if (!providerCfg?.apiKey) {
    throw new Error(
      `No API key configured for provider "${provider}".\nRun: fcc --setup`,
    );
  }

  return {
    provider,
    apiKey: providerCfg.apiKey,
    model: modelOverride ?? providerCfg.model ?? getDefaultModel(provider),
    baseURL: getBaseURL(provider),
  };
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

export async function runSetup(): Promise<Config> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q: string): Promise<string> =>
    new Promise(resolve => rl.question(q, answer => resolve(answer.trim())));

  console.log('\n\x1b[1mfcc Setup\x1b[0m — Configure your AI providers');
  console.log(
    '\x1b[2mGet a free Groq API key at https://console.groq.com\x1b[0m\n',
  );

  const existing = loadConfig();

  const groqKey = await ask(
    `Groq API key (free, recommended)${existing?.providers.groq?.apiKey ? ' [enter to keep]' : ''}: `,
  );
  const openaiKey = await ask(
    `OpenAI API key${existing?.providers.openai?.apiKey ? ' [enter to keep]' : ' [optional]'}: `,
  );
  const geminiKey = await ask(
    `Gemini API key${existing?.providers.gemini?.apiKey ? ' [enter to keep]' : ' [optional, free tier]'}: `,
  );

  rl.close();

  const config: Config = {
    provider: existing?.provider ?? 'groq',
    providers: { ...existing?.providers },
  };

  if (groqKey)
    config.providers.groq = {
      apiKey: groqKey,
      model: getDefaultModel('groq'),
    };
  if (openaiKey)
    config.providers.openai = {
      apiKey: openaiKey,
      model: getDefaultModel('openai'),
    };
  if (geminiKey)
    config.providers.gemini = {
      apiKey: geminiKey,
      model: getDefaultModel('gemini'),
    };

  // Auto-select default provider
  if (config.providers.groq?.apiKey) config.provider = 'groq';
  else if (config.providers.openai?.apiKey) config.provider = 'openai';
  else if (config.providers.gemini?.apiKey) config.provider = 'gemini';

  saveConfig(config);

  console.log(`\n\x1b[32mConfig saved.\x1b[0m Default provider: \x1b[1m${config.provider}\x1b[0m (${config.providers[config.provider]?.model})\n`);

  return config;
}

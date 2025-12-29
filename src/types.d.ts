/// <reference types="chrome" />
/// <reference types="vite/client" />

interface PuterChatOptions {
  model?: string;
  [key: string]: unknown;
}

interface PuterChatMessage {
  content: string;
}

interface PuterChatResponse {
  message?: PuterChatMessage;
  [key: string]: unknown;
}

interface PuterAI {
  chat(prompt: string, options?: PuterChatOptions): Promise<string | PuterChatResponse>;
}

interface PuterAuth {
  isSignedIn(): boolean;
  signIn(): Promise<void>;
}

interface Puter {
  auth: PuterAuth;
  ai: PuterAI;
  authToken?: string;
}

declare module '*puter-web' {
  const puter: Puter;
  export default puter;
}

interface Window {
  puter: Puter;
}

// Gera o valor do segredo ADMIN_SENHA_HASH a partir da senha (lida da variável SENHA, nunca de arquivo).
// Uso: SENHA='...' node scripts/gerar-hash.mjs | npx wrangler secret put ADMIN_SENHA_HASH
import { gerarHash } from '../src/auth.js';
if (!process.env.SENHA) { console.error('Defina a variável SENHA.'); process.exit(1); }
process.stdout.write(await gerarHash(process.env.SENHA));

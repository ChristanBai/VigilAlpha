import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function experimentalKronosForecast(payload, { env = process.env } = {}) {
  if (!env.VIGILALPHA_KRONOS_MODEL_DIR || !env.VIGILALPHA_KRONOS_TOKENIZER_DIR) {
    return { status: 'UNAVAILABLE', reason: 'LOCAL_MODEL_CONFIGURATION_REQUIRED', executionAuthority: 'NONE' };
  }
  const input = JSON.stringify(payload);
  if (Buffer.byteLength(input) > 500000) throw new Error('Model input too large');
  const runner = fileURLToPath(new URL('../../scripts/kronos-forecast.py', import.meta.url));
  return new Promise(resolve => {
    const child = spawn(env.VIGILALPHA_EXPERIMENT_PYTHON || 'python3', [runner, '--model-dir', env.VIGILALPHA_KRONOS_MODEL_DIR, '--tokenizer-dir', env.VIGILALPHA_KRONOS_TOKENIZER_DIR], {
      env: { PATH: env.PATH || process.env.PATH, SYSTEMROOT: env.SYSTEMROOT, PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' },
      stdio: ['pipe','pipe','pipe']
    });
    let output = '', settled = false;
    const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({status:'UNAVAILABLE',reason:'MODEL_TIMEOUT',executionAuthority:'NONE'}); }, 60000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 2000000) { child.kill('SIGKILL'); finish({status:'UNAVAILABLE',reason:'MODEL_OUTPUT_LIMIT',executionAuthority:'NONE'}); } });
    child.stderr.on('data', () => {}); // Do not expose local paths or dependency traces through MCP.
    child.on('error', () => finish({status:'UNAVAILABLE',reason:'MODEL_RUNTIME_UNAVAILABLE',executionAuthority:'NONE'}));
    child.stdin.on('error', () => {});
    child.on('close', () => {
      try { const result = JSON.parse(output); finish({...result,executionAuthority:'NONE',autoPromotion:false}); }
      catch { finish({status:'UNAVAILABLE',reason:'MODEL_RESPONSE_INVALID',executionAuthority:'NONE'}); }
    });
    child.stdin.end(input);
  });
}

import * as fs from 'fs';
import * as path from 'path';

export class RunnerLogger {
  private logPath: string;
  private logBuffer: string[] = [];
  private rut: string;
  private step: number;

  constructor(rut: string, step: number) {
    this.rut = rut;
    this.step = step;
    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logPath = path.join(outputDir, `run_${rut}_step${step}_${timestamp}.log`);
  }

  log(msg: string): void {
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
    const line = `[${ts}] ${msg}`;
    console.log(line);
    this.logBuffer.push(line);
    fs.appendFileSync(this.logPath, line + '\n');
  }

  error(msg: string, err?: any): void {
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
    let line = `[${ts}] ❌ ERROR: ${msg}`;
    if (err) {
      line += ` | ${err.stack || err.message || err}`;
    }
    console.error(line);
    this.logBuffer.push(line);
    fs.appendFileSync(this.logPath, line + '\n');
  }

  getLogPath(): string {
    return this.logPath;
  }

  getBufferText(): string {
    return this.logBuffer.join('\n');
  }
}

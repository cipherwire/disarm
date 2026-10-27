/**
 * Structured record of what the pipeline did.
 * Every pass logs its own change count and notes, so output is auditable
 * rather than a black box.
 */
export class Report {
  constructor() {
    this.passes = [];
    this.warnings = [];
    this.meta = {};
    this.telemetry = null;
    this._current = null;
  }

  setTelemetry(telemetry) {
    this.telemetry = telemetry;
  }

  startPass(name, description = '') {
    this._current = { name, description, changes: 0, notes: [] };
  }

  endPass() {
    if (this._current) this.passes.push(this._current);
    this._current = null;
  }

  count(n = 1) {
    if (this._current) this._current.changes += n;
  }

  note(message) {
    if (this._current) this._current.notes.push(message);
  }

  warn(message) {
    this.warnings.push(message);
  }

  totalChanges() {
    return this.passes.reduce((sum, pass) => sum + pass.changes, 0);
  }

  toJSON() {
    return {
      tool: 'disarm',
      generatedAt: new Date().toISOString(),
      totalChanges: this.totalChanges(),
      telemetry: this.telemetry ?? null,
      passes: this.passes,
      warnings: this.warnings,
      meta: this.meta,
    };
  }
}

export enum AIState {
  IDLE = 'IDLE',
  WANDER = 'WANDER',
  FOLLOW = 'FOLLOW',
  CHASE = 'CHASE',
  ATTACK = 'ATTACK',
  FLEE = 'FLEE',
  SEARCH = 'SEARCH',
  RETURN = 'RETURN',
  /** Chasse d'une autre créature (entities/MobRelations.ts). */
  HUNT = 'HUNT',
  DEAD = 'DEAD',
}

export interface StateHandlers<C> {
  enter?(ctx: C, from: AIState): void;
  update(ctx: C, dt: number): AIState | void;
  exit?(ctx: C, to: AIState): void;
}

/** Machine à états finis générique (un état actif, transitions retournées par update). */
export class StateMachine<C> {
  state: AIState = AIState.IDLE;
  timeInState = 0;
  constructor(private handlers: Partial<Record<AIState, StateHandlers<C>>>, private ctx: C) {}

  set(next: AIState) {
    if (next === this.state) return;
    const prev = this.state;
    this.handlers[prev]?.exit?.(this.ctx, next);
    this.state = next;
    this.timeInState = 0;
    this.handlers[next]?.enter?.(this.ctx, prev);
  }

  update(dt: number) {
    this.timeInState += dt;
    const h = this.handlers[this.state];
    if (!h) return;
    const next = h.update(this.ctx, dt);
    if (next && next !== this.state) this.set(next);
  }
}

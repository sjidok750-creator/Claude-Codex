import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@claude-codex/protocol';

/** 허브 내부 이벤트 버스. 서버가 구독해 WebSocket 으로 중계한다. */
export class Bus {
  private ee = new EventEmitter();

  constructor() {
    this.ee.setMaxListeners(100);
  }

  emit(event: ServerEvent): void {
    this.ee.emit('event', event);
  }

  on(listener: (event: ServerEvent) => void): () => void {
    this.ee.on('event', listener);
    return () => this.ee.off('event', listener);
  }
}

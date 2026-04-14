import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, filter, map } from 'rxjs';
import { HUData } from '../../models/hu-data.model';

interface HuSyncPayload {
  huId: string;
  hu: HUData;
  testPlanId?: string;
  updatedAt: number;
  source: 'refiner' | 'editor' | 'viewer' | 'execution' | 'unknown';
}

@Injectable({
  providedIn: 'root'
})
export class HuSyncService {
  private readonly huSyncSubject = new BehaviorSubject<HuSyncPayload | null>(null);
  private readonly latestHuCache = new Map<string, HUData>();
  private readonly channelName = 'hu-sync-channel';
  private broadcastChannel: BroadcastChannel | null = null;

  readonly huSync$: Observable<HuSyncPayload> = this.huSyncSubject.asObservable().pipe(
    filter((payload): payload is HuSyncPayload => !!payload)
  );

  constructor() {
    if (typeof window === 'undefined') return;

    // Restaurar datos desde localStorage
    try {
      const cachedData = localStorage.getItem('hu_sync_cache');
      if (cachedData) {
        const parsedCache = JSON.parse(cachedData) as Record<string, HUData>;
        Object.entries(parsedCache).forEach(([huId, hu]) => {
          this.latestHuCache.set(huId, hu);
        });
      }
    } catch {
      // no-op
    }

    if (typeof BroadcastChannel !== 'undefined') {
      this.broadcastChannel = new BroadcastChannel(this.channelName);
      this.broadcastChannel.onmessage = (event: MessageEvent<HuSyncPayload>) => {
        const payload = event?.data;
        if (!payload?.huId || !payload?.hu) return;

        this.latestHuCache.set(payload.huId, payload.hu);
        this.saveCacheToLocalStorage(); // Guardar en localStorage
        this.huSyncSubject.next(payload);
      };
    }
  }

  publishHuUpdate(hu: HUData, testPlanId: string = '', source: HuSyncPayload['source'] = 'unknown'): void {
    if (!hu?.id) return;

    const payload: HuSyncPayload = {
      huId: hu.id,
      hu: JSON.parse(JSON.stringify(hu)),
      testPlanId,
      updatedAt: Date.now(),
      source
    };

    this.latestHuCache.set(payload.huId, payload.hu);
    this.saveCacheToLocalStorage(); // Guardar en localStorage

    try {
      this.broadcastChannel?.postMessage(payload);
    } catch {
      // no-op
    }

    this.huSyncSubject.next(payload);
  }

  private saveCacheToLocalStorage(): void {
    try {
      const cacheObject = Object.fromEntries(this.latestHuCache);
      localStorage.setItem('hu_sync_cache', JSON.stringify(cacheObject));
    } catch {
      // no-op
    }
  }

  clearCache(): void {
    try {
      localStorage.removeItem('hu_sync_cache');
      this.latestHuCache.clear();
    } catch {
      // no-op
    }
  }

  getLatestHu(huId: string): HUData | null {
    if (!huId) return null;
    return this.latestHuCache.get(huId) || null;
  }

  watchHu(huId: string): Observable<HUData> {
    return this.huSync$.pipe(
      filter((payload) => payload.huId === huId),
      map((payload) => payload.hu)
    );
  }
}

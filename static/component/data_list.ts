/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />

import { type ListElement, TimeList } from "../utils/list.ts";

export type TimeData = { time: number; [key: string]: number };

/** グラフ表示用のデータを保存するクラス（双方向連結リストを拡張） */
export class DataList extends TimeList<TimeData> {
  /** キーごとの最大値 */
  #max: { [key: string]: number }; // グラフの大きさを決めるために使用
  /** キーごとの最小値 */
  #min: { [key: string]: number }; // グラフの大きさを決めるために使用
  /** 過去データを取得する関数 */
  #requestOldData: (fromTime?: number) => Promise<TimeData[]>;
  /** リアルタイムデータを取得するためのEventSourceを取得する関数 */
  #getEventSource: () => EventSource;
  /** データの更新が行われた時に呼び出す関数のリスト */
  #onUpdateFunc: Set<() => void>;
  /** データに新しいキーが追加された時に呼び出す関数のリスト */
  #onUpdateKeyFunc: Set<(str: string) => void>;
  /** キーのリスト */
  #keys: Set<string>;
  /** データがないかどうか */
  empty = true;
  constructor({ requestOldData, getEventSource }: {
    requestOldData: (fromTime?: number) => Promise<TimeData[]>;
    getEventSource: () => EventSource;
  }) {
    super();
    this.#requestOldData = requestOldData;
    this.#getEventSource = getEventSource;
    this.#max = {};
    this.#min = {};
    this.#loadingPromise = Promise.resolve();
    this.#onUpdateFunc = new Set();
    this.#onUpdateKeyFunc = new Set();
    this.#keys = new Set(["time"]); // timeは元から存在
  }
  /** 先頭にデータを追加 */
  addFirst(value: TimeData) {
    this.throwIfDestroyed();
    this.empty = true;
    const kvValue = Object.entries(value);
    this.#updateMaxValue(kvValue);
    this.#updateMinValue(kvValue);
    this.#updateKey(kvValue);
    const res = super.addFirst(value);
    for (const fn of this.#onUpdateFunc) {
      fn();
    }
    return res;
  }
  /** 末尾にデータを追加 */
  addLast(value: TimeData) {
    this.throwIfDestroyed();
    this.empty = true;
    const kvValue = Object.entries(value);
    this.#updateMaxValue(kvValue);
    this.#updateMinValue(kvValue);
    this.#updateKey(kvValue);
    const res = super.addLast(value);
    for (const fn of this.#onUpdateFunc) {
      fn();
    }
    return res;
  }
  /** 先頭に別のリストを連結 */
  margeFirst(target: DataList) {
    this.empty = this.empty || target.empty;
    this.throwIfDestroyed();
    this.#updateMaxValue(Object.entries(target.#max));
    this.#updateMinValue(Object.entries(target.#min));
    this.#updateKey(Object.entries(target.#min));
    super.margeFirst(target);
    for (const fn of this.#onUpdateFunc) {
      fn();
    }
  }
  /** 末尾に別のリストを連結 */
  margeLast(target: DataList) {
    this.empty = this.empty || target.empty;
    this.throwIfDestroyed();
    this.#updateMaxValue(Object.entries(target.#max));
    this.#updateMinValue(Object.entries(target.#min));
    this.#updateKey(Object.entries(target.#min));
    this.#latestTime = target.#latestTime && this.#latestTime
      ? Math.max(target.#latestTime, this.#latestTime)
      : target.#latestTime ?? this.#latestTime;
    super.margeLast(target);
    for (const fn of this.#onUpdateFunc) {
      fn();
    }
  }
  /** 最大値データをアップデート */
  #updateMaxValue(data: [string, number][]) {
    for (const [key, val] of data) {
      this.#max[key] = this.#max[key] == undefined
        ? val
        : Math.max(this.#max[key], val);
    }
  }
  /** 最小値データをアップデート */
  #updateMinValue(data: [string, number][]) {
    for (const [key, val] of data) {
      this.#min[key] = this.#min[key] == undefined
        ? val
        : Math.min(this.#min[key], val);
    }
  }
  /** データのキーの一覧を更新 */
  #updateKey(data: [string, number][]) {
    for (const [key] of data) {
      if (!this.#keys.has(key)) {
        this.#keys.add(key);
        // 新しいキーが追加されたらonUpdateKeyFuncを呼び出す
        for (const fn of this.#onUpdateKeyFunc) {
          fn(key);
        }
      }
    }
  }
  /** 最大値を取得 */
  getMaxVal(...keys: string[]) {
    const val = keys.map((key) => this.#max[key]).filter((v) => v !== null);
    if (val.length) {
      return Math.max(...val);
    }
  }
  /** 最小値を取得 */
  getMinVal(...keys: string[]) {
    const val = keys.map((key) => this.#min[key]).filter((v) => v !== null);
    if (val.length) {
      return Math.min(...val);
    }
  }
  /** この時刻より前のデータの読み込みは完了している */
  #latestTime: number | null = null;
  /** この時刻より前にデータは存在しないので、読み込む必要はない */
  #oldestTime: number | null = null;
  #loadingPromise: Promise<void | boolean>;
  // 起点時刻～終了時刻の前後部分も一気に読み込んでしまう
  // 何も指定せず1回読み込み(リストは空)
  // 起点時刻と終了時刻を指定して複数回読み込み(リストは空)
  // 起点時刻と終了時刻を指定して複数回読み込み
  requestData(
    range?: { oldestTime: number; latestTime: number },
    { allowAdditionalRange = true } = {},
  ) {
    return this.#loadingPromise = this.#loadingPromise.then(async () => {
      if (!range) {
        if (!this.first.done) {
          throw new Error(
            "Calls to non-empty lists that do not specify a range are not supported.",
          );
        }
        // リストが空の場合：初期データ読み込み（範囲指定せず1回読み込み）
        await this.#internalRequestData(null, null);
        return true;
      }
      const { oldestTime, latestTime } = range;
      const oldestTimeForAdditionalRange = allowAdditionalRange
        ? oldestTime * 2 - latestTime
        : oldestTime;
      const latestTimeForAdditionalRange = allowAdditionalRange
        ? latestTime * 2 - oldestTime
        : latestTime;
      if (this.first.done) {
        if (this.#latestTime === Infinity) {
          return;
        }
        // リストが空の場合：初期データ読み込み（範囲指定）
        await this.#internalRequestData(
          oldestTimeForAdditionalRange,
          latestTimeForAdditionalRange,
        );
        return true;
      }

      let loaded = false;
      if (oldestTime < this.first.value.time) {
        await this.#internalRequestData(oldestTimeForAdditionalRange, null);
        loaded = true;
      }
      if (this.#latestTime !== null && this.#latestTime < latestTime) {
        const newData = new DataList({
          requestOldData: this.#requestOldData,
          getEventSource: this.#getEventSource,
        });
        await newData.#internalRequestData(
          this.#latestTime,
          latestTimeForAdditionalRange,
          true,
        );
        this.margeLast(newData);
        loaded = true;
      }
      return loaded;
    }).catch(console.error);
  }
  /** nullの時は1回読み込み, 数値の時はその時刻まで読み込み */
  async #internalRequestData(
    oldestTime: number | null,
    latestTime: number | null,
    stopLoadingIfOldestTime = false,
  ) {
    // 古い側のデータを読み込んでリストの前に繋げていく
    let loadStartTime: number | undefined;
    if (this.first.done) {
      loadStartTime = latestTime ?? undefined;
      if (latestTime !== null) {
        if (this.#latestTime === null || this.#latestTime < latestTime) {
          this.#latestTime = Math.min(latestTime, Date.now());
        }
      }
    } else {
      loadStartTime = this.first.value.time;
    }
    if (
      loadStartTime && this.#oldestTime && loadStartTime <= this.#oldestTime
    ) {
      // this.#oldestTimeより古い時刻を読み込んでも何も返ってこない
      return;
    }
    const result = await this.#requestOldData(loadStartTime);
    if (result.length === 0) {
      this.#oldestTime = this.#oldestTime == null
        ? loadStartTime ?? null
        : Math.max(loadStartTime ?? Date.now(), this.#oldestTime);
      return;
    }
    let breaked = false;
    for (const data of result) {
      if (
        stopLoadingIfOldestTime && oldestTime !== null && data.time < oldestTime
      ) {
        breaked = true;
        break;
      }
      this.addFirst(data);
    }
    if (!this.last.done) {
      this.#latestTime ??= this.last.value.time;
    }
    if (
      !breaked &&
      oldestTime !== null && !this.first.done &&
      oldestTime < this.first.value.time
    ) {
      await this.#internalRequestData(
        oldestTime,
        null,
        stopLoadingIfOldestTime,
      );
    }
  }
  getElementFromTime(time: number, initialPointer?: ListElement<TimeData>) {
    this.throwIfDestroyed();
    if (this.first.done) {
      return;
    }
    let pointer = initialPointer ?? this.first;
    if (pointer.value.time < time) {
      while (!pointer.next.done && pointer.next.value.time <= time) {
        pointer = pointer.next;
      }
    } else {
      while (!pointer.prev.done && time < pointer.value.time) {
        pointer = pointer.prev;
      }
    }
    return pointer;
  }
  /** リアルタイム通信を行うEventSource */
  #eventSource?: EventSource;
  /** リアルタイム通信を開始する */
  startStreaming() {
    if (!this.#eventSource) {
      this.#eventSource = this.#getEventSource();
      const loadLatestData = new Promise<void>((ok) => {
        // openした時点までのデータを取得して追加する
        this.#eventSource?.addEventListener("open", async () => {
          if (this.last.value) {
            await this.requestData({
              oldestTime: this.last.value.time,
              latestTime: Date.now(),
            }, { allowAdditionalRange: false });
          } else {
            await this.requestData();
          }
          this.#latestTime = Infinity;
          ok(); // ^_^
        });
      }).catch(console.error);
      this.#eventSource.addEventListener("message", (e) => {
        const data: TimeData = JSON.parse(e.data);
        loadLatestData.then(() => {
          this.addLast(data);
        });
      });
    }
  }
  /** リアルタイム通信を終わらせる */
  stopStreaming() {
    this.#eventSource?.close();
    this.#eventSource = undefined;
    this.#latestTime = Date.now();
  }
  /** データ追加時に呼ばれるコールバック関数を登録する */
  onUpdate(fn: () => void, { signal }: { signal?: AbortSignal } = {}) {
    if (signal?.aborted) {
      return;
    }
    signal?.addEventListener("abort", () => this.#onUpdateFunc.delete(fn));
    this.#onUpdateFunc.add(fn);
  }
  /** 新しいキーの追加時に呼ばれるコールバック関数を登録する */
  onKeyUpdate(
    fn: (str: string) => void,
    { signal }: { signal?: AbortSignal } = {},
  ) {
    if (signal?.aborted) {
      return;
    }
    signal?.addEventListener("abort", () => this.#onUpdateKeyFunc.delete(fn));
    this.#onUpdateKeyFunc.add(fn);
  }
}

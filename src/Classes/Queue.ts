export default class Queue<T> {
    private items: T[] = [];

    enqueue(item: T): void {
        this.items.push(item);
    }

    dequeue(): T | undefined {
        return this.items.shift();
    }

    isEmpty(): boolean {
        return this.items.length === 0;
    }

    size(): number {
        return this.items.length;
    }

    peek(): T | undefined {
        return this.items[0];
    }
    getAllElements(): T[] {
        return [...this.items]; // Returns a shallow copy of the items array
    }
}

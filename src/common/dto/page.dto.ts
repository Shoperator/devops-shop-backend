/**
 * One page of a list endpoint. Every paginated resource answers with this same
 * envelope so a client only has to learn it once.
 */
export class PageDto<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  /** Pre-computed so clients can render pagination without repeating the math. */
  totalPages: number;

  static of<T>(
    items: T[],
    total: number,
    page: number,
    limit: number,
  ): PageDto<T> {
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Maps the items of a page while keeping the pagination metadata intact. */
  static map<T, R>(page: PageDto<T>, mapItem: (item: T) => R): PageDto<R> {
    return { ...page, items: page.items.map(mapItem) };
  }
}

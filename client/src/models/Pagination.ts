// Pagination model — MVVM Model layer.
// Generic shape returned by paginated list endpoints.
export interface Paginated {
  page: number;
  limit: number;
  total: number;
  totalPages?: number;
}

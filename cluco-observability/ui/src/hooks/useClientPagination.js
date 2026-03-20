import { useState, useMemo } from 'react'

export function useClientPagination(data, defaultPageSize = 25) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const totalItems = data.length
  const paginatedData = useMemo(
    () => data.slice((page - 1) * pageSize, page * pageSize),
    [data, page, pageSize]
  )
  const resetPage = () => setPage(1)
  return { page, setPage, pageSize, setPageSize, totalItems, paginatedData, resetPage }
}

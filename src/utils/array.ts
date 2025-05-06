export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

export function chunks<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) {
    return []
  }

  return items.reduce(
    (acc: T[][], curr: T) => {
      if (acc[acc.length - 1].length === chunkSize) {
        acc.push([curr])
      } else {
        acc[acc.length - 1].push(curr)
      }
      return acc
    },
    [[]]
  )
}

// Central config for the three sub-businesses.
export const BUSINESSES = [
  { key: 'books',   label: 'Books',   unit: 'piece', hasSupply: true,  color: '#2563eb' },
  { key: 'tofu',    label: 'Tofu',    unit: 'kg',    hasSupply: true,  color: '#16a34a' },
  { key: 'cantine', label: 'Cantine', unit: 'piece', hasSupply: false, color: '#ea580c' },
]

export const businessOf = (k) => BUSINESSES.find(b => b.key === k)

// Suggested expense categories (free text still allowed).
export const EXPENSE_CATEGORIES = {
  books:   ['salary', 'inks', 'printer_repair', 'other'],
  tofu:    ['soya_beans', 'transport', 'other'],
  cantine: ['ingredients', 'gas', 'other'],
  overall: ['rent', 'staff_food', 'transport', 'other'],
}

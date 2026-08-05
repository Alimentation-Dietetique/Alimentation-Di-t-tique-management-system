import { NavLink } from 'react-router-dom'

const links = [
  { to: '/sell', label: 'Sell', icon: '🛒' },
  { to: '/debts', label: 'Debts', icon: '💳' },
  { to: '/expenses', label: 'Expenses', icon: '💸' },
  { to: '/products', label: 'Stock', icon: '📦' },
  { to: '/dashboard', label: 'Reports', icon: '📊' },
]

export default function Nav({ onSignOut }) {
  return (
    <nav className="bottomnav">
      {links.map((l) => (
        <NavLink key={l.to} to={l.to} className={({ isActive }) => 'navitem' + (isActive ? ' active' : '')}>
          <span className="navicon">{l.icon}</span>
          <span>{l.label}</span>
        </NavLink>
      ))}
      <button className="navitem" onClick={onSignOut} title="Sign out">
        <span className="navicon">⎋</span>
        <span>Out</span>
      </button>
    </nav>
  )
}

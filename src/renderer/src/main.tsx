import { createRoot } from 'react-dom/client'
import App from './App'
import { api } from './api'
import './styles.css'

document.documentElement.dataset.platform = api.platform

const container = document.getElementById('root')
if (container === null) throw new Error('Missing #root element')
createRoot(container).render(<App />)

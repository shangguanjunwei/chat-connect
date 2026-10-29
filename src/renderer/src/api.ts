import type { DshStudioApi } from '../../shared/types'

declare global {
  interface Window {
    dshStudio: DshStudioApi
  }
}

export const api: DshStudioApi = window.dshStudio

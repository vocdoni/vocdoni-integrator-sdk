import caReactComponents from './locales/ca/react-components.json'
import enReactComponents from './locales/en/react-components.json'
import esReactComponents from './locales/es/react-components.json'

export const reactComponentsNamespace = 'react-components'
export const reactComponentsDefaultLanguage = 'en'

export const reactComponentsResources = {
  [reactComponentsDefaultLanguage]: {
    [reactComponentsNamespace]: enReactComponents,
  },
  ca: {
    [reactComponentsNamespace]: caReactComponents,
  },
  es: {
    [reactComponentsNamespace]: esReactComponents,
  },
}

export type Locale = {
  [key: string]: string | Locale
}

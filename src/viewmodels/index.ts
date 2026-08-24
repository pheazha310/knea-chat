// MVVM ViewModel layer — barrel export.
//
// ViewModels hold view state and commands, binding Views to the Model layer.
// The chat view model lives here; app-level shared ViewModels (auth, theme,
// toast) are provided by the context providers in `src/contexts`.
export * from './useChatViewModel';

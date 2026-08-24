import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the sign-in screen for unauthenticated visitors', () => {
  render(<App />);
  // Unauthenticated visitors land on the login page with the demo quick-sign-in.
  expect(screen.getByText(/welcome back/i)).toBeInTheDocument();
  expect(screen.getByText(/sign in to your workspace/i)).toBeInTheDocument();
  expect(screen.getByText(/try a demo account/i)).toBeInTheDocument();
});

/// <reference types="jest" />
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NotificationReactionAction from './NotificationReactionAction';
import { useAuthStore } from '../../store/authStore';
import type { Notification, Reaction } from '../../models';

// The component dispatches to the domain stores through this util — mock it so
// tests never touch the network.
jest.mock('../../utils/toggleTargetReaction', () => ({
  toggleTargetReaction: jest.fn(),
}));
import { toggleTargetReaction } from '../../utils/toggleTargetReaction';

const mockedToggle = toggleTargetReaction as jest.MockedFunction<
  typeof toggleTargetReaction
>;

const baseNotification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 10,
  user_id: 2,
  actor_id: 3,
  type: 'mention',
  title: 'Maya mentioned you',
  message: 'Can you review the plan?',
  data: { conversationId: 7, messageId: 42 },
  is_read: 0,
  created_at: '2026-09-05T10:00:00Z',
  ...overrides,
});

const row = (overrides: Partial<Reaction> = {}): Reaction => ({
  id: 1,
  message_id: 42,
  user_id: 3,
  reaction: '👍',
  first_name: 'Maya',
  last_name: 'Kim',
  ...overrides,
});

const setMe = (id: number | null) => {
  act(() => {
    useAuthStore.setState({ user: id === null ? null : ({ id } as any) });
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedToggle.mockResolvedValue([row()]);
  setMe(null);
});

describe('NotificationReactionAction', () => {
  it('renders nothing for a notification without a reactable target', () => {
    const { container } = render(
      <NotificationReactionAction
        notification={baseNotification({ type: 'missed_call', data: { callerUserId: 3 } })}
        onAcknowledged={jest.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders for announcement and task targets too', () => {
    render(
      <NotificationReactionAction
        notification={baseNotification({
          type: 'announcement',
          data: { announcementId: 99 },
        })}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'React to the announcement' }),
    ).toBeTruthy();
  });

  it('opens the quick picker and adds a reaction on the underlying message', async () => {
    const onAcknowledged = jest.fn();
    const notification = baseNotification();
    render(
      <NotificationReactionAction
        notification={notification}
        onAcknowledged={onAcknowledged}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'React to the message' }),
    );
    // The six quick reactions are offered.
    expect(screen.getAllByRole('button', { name: /^React / })).toHaveLength(6);

    fireEvent.click(screen.getByRole('button', { name: 'React 👍' }));
    await waitFor(() =>
      expect(mockedToggle).toHaveBeenCalledWith(
        { kind: 'message', conversationId: 7, messageId: 42 },
        '👍',
        false,
      ),
    );
    await waitFor(() =>
      expect(screen.getByText(/Reacted/)).toBeTruthy(),
    );
    expect(onAcknowledged).toHaveBeenCalledWith(notification);
  });

  it('shows existing reaction chips with counts and reactor names', () => {
    render(
      <NotificationReactionAction
        notification={baseNotification({
          type: 'announcement',
          data: { announcementId: 99 },
          reactions: [
            row({ reaction: '👍' }),
            row({ reaction: '❤️', user_id: 4, first_name: 'Dara', last_name: 'Sok' }),
            row({ reaction: '❤️', user_id: 5, first_name: 'Chan', last_name: 'Rithy' }),
          ],
        })}
      />,
    );

    // Chip 1: 👍 with count 1; chip 2: ❤️ with count 2 (+ names tooltip).
    const thumbs = screen.getByRole('button', { name: 'React 👍' });
    expect(thumbs.title).toBe('Maya Kim reacted');
    const hearts = screen.getByRole('button', { name: 'React ❤️' });
    expect(hearts.textContent).toContain('2');
    expect(hearts.title).toBe('Dara Sok, Chan Rithy reacted');
  });

  it('removes my reaction when I pick an emoji I already reacted with', async () => {
    setMe(3);
    const notification = baseNotification({
      reactions: [row({ user_id: 3 })],
    });
    render(<NotificationReactionAction notification={notification} />);

    const mineChip = screen.getByRole('button', {
      name: 'Remove your 👍 reaction',
    });
    expect(mineChip.className).toContain('mine');
    fireEvent.click(mineChip);
    await waitFor(() =>
      expect(mockedToggle).toHaveBeenCalledWith(
        { kind: 'message', conversationId: 7, messageId: 42 },
        '👍',
        true,
      ),
    );
  });

  it('opens the wider catalog picker from the quick row and reacts from it', async () => {
    const onAcknowledged = jest.fn();
    render(
      <NotificationReactionAction
        notification={baseNotification()}
        onAcknowledged={onAcknowledged}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'React to the message' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'More reactions' }));

    // Category tabs are present (full catalog).
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Smileys' })).toBeTruthy(),
    );
    // 🎉 lives under the Objects category in the catalog.
    fireEvent.click(screen.getByRole('tab', { name: 'Objects' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'React 🎉' }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'React 🎉' }));

    await waitFor(() =>
      expect(mockedToggle).toHaveBeenCalledWith(
        { kind: 'message', conversationId: 7, messageId: 42 },
        '🎉',
        false,
      ),
    );
    expect(onAcknowledged).toHaveBeenCalled();
  });

  it('surfaces an error and does not acknowledge when the request fails', async () => {
    mockedToggle.mockResolvedValue(null);
    const onAcknowledged = jest.fn();
    render(
      <NotificationReactionAction
        notification={baseNotification()}
        onAcknowledged={onAcknowledged}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'React to the message' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'React ❤️' }));
    await waitFor(() =>
      expect(screen.getByText(/Could not react/)).toBeTruthy(),
    );
    expect(onAcknowledged).not.toHaveBeenCalled();
  });
});

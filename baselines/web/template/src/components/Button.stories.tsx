import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent } from 'storybook/test'

import { Button } from './Button.tsx'

/**
 * Stories are the component tests: each renders in a real browser under
 * Vitest (`pnpm test`), runs its play function, and fails on any axe
 * violation. Write the interaction here rather than in a separate test file.
 */
const meta = {
  component: Button,
  args: { children: 'Save', onClick: fn() },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}

export const Keyboard: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Save' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(args.onClick).not.toHaveBeenCalled()
  },
}

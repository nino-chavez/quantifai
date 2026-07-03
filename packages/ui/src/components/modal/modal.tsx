import { forwardRef, type ComponentProps } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * Modal — composable wrapper around Radix Dialog. No monolith form;
 * modals are inherently composable.
 *
 *   import * as Modal from '@blueprint/ui/modal';
 *
 *   <Modal.Root>
 *     <Modal.Trigger asChild><Button>Open</Button></Modal.Trigger>
 *     <Modal.Portal>
 *       <Modal.Overlay />
 *       <Modal.Content>
 *         <Modal.Header>
 *           <Modal.Title>Confirm</Modal.Title>
 *           <Modal.Description>Are you sure?</Modal.Description>
 *         </Modal.Header>
 *         <div>Body content</div>
 *         <Modal.Footer>
 *           <Modal.Close asChild><Button variant="outline">Cancel</Button></Modal.Close>
 *           <Button>Confirm</Button>
 *         </Modal.Footer>
 *       </Modal.Content>
 *     </Modal.Portal>
 *   </Modal.Root>
 */

export const Root = DialogPrimitive.Root;
export const Trigger = DialogPrimitive.Trigger;
export const Portal = DialogPrimitive.Portal;
export const Close = DialogPrimitive.Close;

export const Overlay = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof DialogPrimitive.Overlay>
>(function ModalOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-slot="modal-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  );
});

export interface ContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  showCloseButton?: boolean;
}

export const Content = forwardRef<HTMLDivElement, ContentProps>(
  function ModalContent({ className, children, showCloseButton = true, ...props }, ref) {
    return (
      <DialogPrimitive.Content
        ref={ref}
        data-slot="modal-content"
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'w-full max-w-lg rounded-lg border border-contrast-200 bg-background p-6 shadow-xl',
          'flex flex-col gap-4',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'focus:outline-none',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="modal-close"
            aria-label="Close"
            className={cn(
              'absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-sm',
              'text-contrast-500 transition-colors duration-fast ease-standard',
              'hover:bg-contrast-100 hover:text-foreground',
              'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            )}
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    );
  },
);

export const Header = forwardRef<HTMLDivElement, ComponentProps<'div'>>(
  function ModalHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="modal-header"
        className={cn('flex flex-col gap-1.5', className)}
        {...props}
      />
    );
  },
);

export const Title = forwardRef<
  HTMLHeadingElement,
  ComponentProps<typeof DialogPrimitive.Title>
>(function ModalTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      data-slot="modal-title"
      className={cn(
        'font-heading text-lg font-semibold leading-tight tracking-tight text-foreground',
        className,
      )}
      {...props}
    />
  );
});

export const Description = forwardRef<
  HTMLParagraphElement,
  ComponentProps<typeof DialogPrimitive.Description>
>(function ModalDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      data-slot="modal-description"
      className={cn('text-sm leading-relaxed text-contrast-500', className)}
      {...props}
    />
  );
});

export const Footer = forwardRef<HTMLDivElement, ComponentProps<'div'>>(
  function ModalFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="modal-footer"
        className={cn('mt-2 flex items-center justify-end gap-2', className)}
        {...props}
      />
    );
  },
);

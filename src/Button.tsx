import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
} from "react";
import { Children } from "react";

type ButtonVariant = "default" | "outline";

interface ButtonBaseProps {
  variant?: ButtonVariant;
  className?: string;
}

type NativeButtonProps = ButtonBaseProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: never;
  };

type AnchorButtonProps = ButtonBaseProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  };

type ButtonProps = NativeButtonProps | AnchorButtonProps;

export function Button({
  variant = "default",
  className,
  children,
  ...props
}: ButtonProps) {
  const buttonClassName = ["button", `button--${variant}`, className]
    .filter(Boolean)
    .join(" ");
  const childElements = Children.toArray(children);
  const isIconOnly =
    childElements.length === 1 &&
    typeof childElements[0] !== "string" &&
    typeof childElements[0] !== "number";

  if (typeof props.href === "string") {
    const anchorProps = props as AnchorButtonProps;

    return (
      <a
        {...anchorProps}
        className={buttonClassName}
        data-icon-only={isIconOnly ? true : undefined}
      >
        {children}
      </a>
    );
  }

  const buttonProps = props as NativeButtonProps;

  return (
    <button
      {...buttonProps}
      className={buttonClassName}
      data-icon-only={isIconOnly ? true : undefined}
      type={buttonProps.type ?? "button"}
    >
      {children}
    </button>
  );
}

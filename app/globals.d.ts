declare module "*.css";

declare namespace JSX {
    interface IntrinsicElements {
        "ui-nav-menu": React.DetailedHTMLProps<
            React.HTMLAttributes<HTMLElement>,
            HTMLElement
        >;
    }
}

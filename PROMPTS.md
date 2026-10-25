---

# TrustVault Development Prompt Library

This section contains reusable development prompts for the TrustVault brand identity, landing page design, animations, authentication interface, and layout improvements.

## Table of Contents

1. [TrustVault Brand and Logo Redesign](#1-trustvault-brand-and-logo-redesign)
2. [Landing Page Design and Alignment](#2-landing-page-design-and-alignment)
3. [Landing Page Animations](#3-landing-page-animations)
4. [Separate Sign In Page](#4-separate-sign-in-page)
5. [Landing Page Section Overflow Fix](#5-landing-page-section-overflow-fix)

## 1. TrustVault Brand and Logo Redesign

### Objective

Redesign the TrustVault logo with a premium, modern, professional identity suitable for a cybersecurity and secure document vault product.

### Brand Colour Palette

Use these three colours consistently:

1. **Mocha Brown** — primary colour representing warmth, depth, and sophistication.
2. **Platinum Silver** — metallic accents representing technology, precision, and security.
3. **Pale Lavender** — subtle highlights representing intelligence, innovation, and trust.

Keep the colours balanced and elegant. Avoid overly bright neon colours, excessive gradients, cartoonish graphics, and cluttered visuals.

### Logo Concept

Create a distinctive logo that combines suitable elements of:

- A secure vault or shield.
- A document or file.
- A subtle lock or checkmark representing security and trust.
- A modern digital or AI-inspired detail, if appropriate.

Include the **TrustVault** wordmark with clean, modern typography. Ensure the icon and wordmark are balanced, recognizable at small sizes, and suitable for a professional cybersecurity brand.

### Animation Requirements

Implement refined, lightweight animations:

1. **Smooth entrance:** Fade in the logo while gently moving it into position.
2. **Security pulse:** Add a subtle glow or soft pulse around the shield or vault outline.
3. **Silver shimmer:** Sweep a restrained platinum-silver highlight across the logo occasionally.
4. **Lavender accent:** Allow a small pale-lavender highlight to appear and fade softly.
5. **Hover interaction:** Apply a gentle scale-up effect and subtle glow when users hover over the logo.
6. **Loading animation:** Optionally create a simplified animated logo mark for loading screens.

Animations must be smooth and elegant. Avoid constant flashing, fast spinning, excessive bouncing, or distracting effects.

### Technical Requirements

- Inspect the existing repository and identify the current logo, branding assets, and frontend framework before making changes.
- Integrate the logo into the existing React, TypeScript, and Vite frontend.
- Prefer SVG for crisp rendering and CSS animations for lightweight effects.
- Use reusable components and keep logo-specific styles separate from unrelated application styles.
- Support light and dark backgrounds where appropriate.
- Ensure the logo works on desktop and mobile.
- Respect `prefers-reduced-motion`.
- Avoid heavy dependencies and preserve existing authentication, routes, and document-vault functionality.
- Apply the brand colours consistently without redesigning unrelated screens.

### Deliverables

1. Primary logo with icon and wordmark.
2. Standalone icon for compact navigation.
3. Favicon or browser-tab icon.
4. Animated website logo.
5. Static logo version.
6. Optional loading animation.

### Quality and Validation

The final result should communicate security, privacy, reliability, and sophisticated technology. It must look like a polished, production-ready cybersecurity brand.

After implementation, run the frontend build, fix errors introduced by the changes, and summarize the files modified and how to preview the logo.

Do not modify Git history, fabricate activity, or include personal or unprofessional content in project files.

## 2. Landing Page Design and Alignment

### Objective

Improve the TrustVault landing page layout to achieve a polished, consistent, responsive, and professional user experience.

### Layout and Alignment Requirements

- Ensure consistent margins, padding, spacing, typography, and content widths across all landing page sections.
- Align headings, descriptions, buttons, cards, and illustrations properly.
- Maintain a consistent navigation bar with clear active states.
- Prevent content overlap, unintended blank spaces, clipped elements, and horizontal scrolling.
- Use reusable layout components and a consistent styling system.
- Maintain a clear visual hierarchy across desktop, tablet, and mobile layouts.

### Features and Security Separation

The Security section must not appear unintentionally at the bottom of the Features page.

- Inspect the existing component structure and routing logic to identify the cause.
- Ensure the Features destination displays only its intended content.
- Ensure the Security destination displays its own security-related content.
- Remove unintended duplicated rendering without deleting legitimate content.
- If these are separate routes, render them independently.
- If they are sections on a single landing page, ensure each navigation link targets the correct section.
- Verify that clicking Features and Security consistently displays or scrolls to the correct destination.

### Responsive Design

- Use CSS Grid or Flexbox for predictable, responsive layouts.
- Use centered content containers with consistent maximum widths.
- Allow content-heavy sections to grow naturally with their contents.
- Stack columns and cards appropriately on smaller screens.
- Ensure navigation, buttons, and cards remain usable on mobile devices.
- Avoid fixed heights and absolute positioning when they cause content overlap.

### Visual Design

Maintain the TrustVault brand palette:

- Mocha Brown.
- Platinum Silver.
- Pale Lavender.

Use consistent typography, button styles, card spacing, borders, shadows, and corner radii. Keep the design elegant, accessible, and suitable for a cybersecurity product.

### Technical Requirements

- Inspect the existing React, TypeScript, and Vite implementation before editing.
- Reuse existing components and routing where possible.
- Avoid duplicate components and conflicting CSS rules.
- Preserve authentication, document-vault functionality, and existing application routes.
- Do not redesign unrelated screens unless necessary for consistent layout.

### Validation

- Run the frontend production build.
- Check for TypeScript and lint errors using the available project scripts.
- Verify the Features and Security navigation behavior.
- Check alignment and responsiveness on desktop, tablet, and mobile.
- Review the final diff and ensure only intended files were modified.

Summarize the layout issues fixed, files changed, and validation results. Do not claim visual verification unless it was actually performed.

## 3. Landing Page Animations

### Objective

Add subtle, cute, elegant animations throughout the TrustVault landing page while maintaining its premium cybersecurity identity.

Animations should make the website feel welcoming, modern, and interactive without distracting users or compromising usability.

### Brand Colours

Use the existing TrustVault palette consistently:

- **Mocha Brown** — primary brand colour.
- **Platinum Silver** — refined metallic accents.
- **Pale Lavender** — soft highlights and decorative effects.

### Hero Section

- Animate the heading and description with a gentle fade-in and upward movement.
- Add subtle floating movement to decorative shield, vault, lock, or document illustrations.
- Animate call-to-action buttons into view.
- Keep all elements aligned and prevent animation-related layout shifts.

### Features Section

- Reveal feature cards with staggered fade-and-rise animations.
- Add gentle scaling or slight rotation to icons on hover.
- Let cards lift slightly with a soft shadow when hovered.
- Maintain consistent card spacing and dimensions.

### Security Section

- Add a subtle pulse or glow to security-related illustrations.
- Use restrained platinum-silver shimmer and pale-lavender highlights.
- Animate security indicators smoothly where appropriate.
- Keep animations within the section boundaries.

### How It Works Section

- Reveal workflow steps sequentially as the user scrolls.
- Animate connecting lines or progress indicators where useful.
- Keep the sequence clear and prevent elements from overlapping adjacent sections.

### Navigation and Buttons

- Apply smooth colour transitions to navigation links and buttons.
- Add subtle hover and focus effects.
- Use gentle scaling or lifting without excessive bouncing.
- Maintain visible keyboard focus and clear interaction states.

### Footer

- Use a subtle entrance animation where appropriate.
- Add restrained hover effects to links and icons.
- Preserve readability and consistent alignment.

### Implementation Requirements

- Inspect the existing frontend and its styling before making changes.
- Prefer CSS transitions and keyframe animations for simple effects.
- Use Intersection Observer or an existing animation library for scroll-triggered effects where appropriate.
- Avoid adding heavy dependencies for decorative animations.
- Prefer `transform` and `opacity` for smooth animations.
- Prevent flickering, layout shifts, excessive repaints, and content overflowing its containers.
- Respect `prefers-reduced-motion` and provide static or simplified effects when requested.
- Ensure animations work smoothly on desktop, tablet, and mobile.
- Avoid flashing, fast spinning, excessive bouncing, or distracting continuous movement.

### Quality and Validation

The animations should feel cute, polished, consistent, and professional—not childish or flashy.

After implementation:

1. Run the frontend production build.
2. Fix errors introduced by the changes.
3. Verify animation behavior and section alignment where browser testing is available.
4. Check reduced-motion behavior.
5. Summarize the files modified and tests performed.

Preserve existing routes, authentication, document-vault features, and unrelated application functionality. Do not modify Git history or create unnecessary commits.

## 4. Separate Sign In Page

### Objective

Make the TrustVault Sign In experience a dedicated page rather than displaying the sign-in form at the bottom of the landing page.

### Routing Requirements

- Inspect the existing authentication components and routing configuration.
- Reuse the existing authentication implementation wherever possible.
- Make the navigation bar's Sign In button navigate to a dedicated route such as `/signin`, or the existing appropriate authentication route.
- Render the sign-in interface independently from the landing page.
- Do not display the landing page's hero, Features, Security, or footer behind the sign-in form unless a shared authentication layout is intentionally part of the design.
- Ensure direct navigation and browser refresh work on the sign-in route.
- Ensure browser back and forward navigation behave correctly.
- Provide a clear way to return to the landing page.

### Sign In Interface

- Use the TrustVault brand palette: Mocha Brown, Platinum Silver, and Pale Lavender.
- Display the existing TrustVault logo with balanced spacing and typography.
- Keep the form clean, responsive, and professionally aligned.
- Include the existing email and password fields and supported authentication controls.
- Add subtle entrance animations without distracting users.
- Ensure the form works on desktop, tablet, and mobile.

### Authentication Integrity

- Preserve the existing backend authentication flow.
- Retain input validation, loading states, error handling, and session management.
- Preserve existing Sign Up and Forgot Password functionality if implemented.
- Do not create a fake login form, hardcode successful authentication, or bypass backend authorization.
- Keep session cookies, credentials, and authentication secrets secure.

### Validation

1. Run the available frontend build and validation commands.
2. Verify that Sign In opens the separate page.
3. Verify that the landing page does not appear behind the sign-in form unintentionally.
4. Test returning to the homepage and browser navigation.
5. Confirm existing authentication behavior remains intact.
6. Summarize the files modified and checks performed.

Do not modify unrelated application functionality or Git history.

---

## 5. Landing Page Section Overflow Fix

### Objective

Fix layout problems in the TrustVault landing page where sections or their contents overflow into, overlap, or visually collide with neighboring sections.

Inspect the existing implementation and use the supplied screenshots as evidence of the layout issues.

### Investigation

Inspect the landing page components, CSS, responsive styles, and animation rules. Identify the actual causes of overlap, including:

- Fixed heights or inappropriate `100vh` constraints.
- Absolute or fixed positioning that removes elements from normal document flow.
- Negative margins and excessive transforms.
- Incorrect Grid or Flexbox sizing.
- Conflicting margins and padding.
- Overflow rules that clip content or create unwanted scrollbars.
- Animations that move elements outside their containers.
- Duplicate section rendering or incorrectly nested components.

Fix the underlying causes rather than applying arbitrary spacing adjustments.

### Required Section Order

Maintain the intended landing page structure:

1. Navigation bar.
2. Hero section.
3. Features section.
4. How It Works section.
5. Security section.
6. Final call-to-action section.
7. Footer.

Preserve existing content unless a targeted correction is required.

### General Layout Requirements

- Prefer normal document flow.
- Use consistent centered content
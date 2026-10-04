# C1 legacy draft review proposal

The PNG shows the actual `LegacyDraftReview` component rendered with synthetic data and the
existing mobile theme CSS and Inter font. The generated HTML/CSS preview is preserved in gitignored `scratch/c1-legacy-review-preview.html`. The two cards illustrate consecutive states, not two cards
that would appear together in the application.

User approved this exact UI in this conversation on 2026-10-04 (“Approve this UI”). The component is now connected to the editor. No preview interaction
reads browser storage, writes a step, or discards a draft. The editor controls explicit
adoption through the transactional store API. The original legacy record remains stored.

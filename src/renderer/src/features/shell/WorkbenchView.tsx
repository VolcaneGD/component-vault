const WorkbenchView = () => (
  <div className="workbench-placeholder" aria-label="Workbench placeholder">
    <section className="workspace-panel workbench-placeholder__editor" aria-labelledby="editor-heading">
      <div className="workspace-panel__heading">
        <span>Editor</span>
        <span className="status-dot">Ready</span>
      </div>
      <h2 id="editor-heading">Select a component to edit</h2>
      <p>HTML, CSS, and JavaScript controls will appear here.</p>
    </section>
    <section className="workspace-panel workbench-placeholder__preview" aria-labelledby="preview-heading">
      <div className="workspace-panel__heading">
        <span>Live preview</span>
        <span>Isolated</span>
      </div>
      <h2 id="preview-heading">Preview is ready</h2>
      <p>The existing sandboxed preview architecture remains unchanged.</p>
    </section>
  </div>
);

export default WorkbenchView;

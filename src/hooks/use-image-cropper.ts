import React from "react";
import { FileWithPath, useDropzone } from "react-dropzone";

import { FileWithPreview } from "@/components/image-cropper";
import { toast } from "@/components/ui/use-toast";

export function useImageCropper() {
  const [selectedFile, setSelectedFile] =
    React.useState<FileWithPreview | null>(null);
  const [isDialogOpen, setDialogOpen] = React.useState(false);

  const onDrop = React.useCallback((acceptedFiles: FileWithPath[]) => {
    const file = acceptedFiles[0];
    if (!file) {
      toast({ description: "Selected image is too large!" });
      return;
    }
    const fileWithPreview = Object.assign(file, {
      preview: URL.createObjectURL(file),
    });
    setSelectedFile(fileWithPreview);
    setDialogOpen(true);
  }, []);

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
  });

  return {
    selectedFile,
    setSelectedFile,
    isDialogOpen,
    setDialogOpen,
    getRootProps,
    getInputProps,
  };
}

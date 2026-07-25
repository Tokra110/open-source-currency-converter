
import os
import zipfile

def pack_extension():
    # Define the name of the output zip file
    zip_filename = 'open-source-currency-converter.zip'

    # Define files and directories to include
    include_files = [
        'manifest.json',
        'LICENSE',
        'README.md',
        'PRIVACY.md'
    ]

    include_dirs = [
        'src',
        'icons'
    ]

    # Get the root directory (parent of the scripts directory)
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_path = os.path.join(root_dir, zip_filename)

    print(f"Creating {zip_filename}...")

    try:
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Add individual files
            for file in include_files:
                file_path = os.path.join(root_dir, file)
                if os.path.exists(file_path):
                    print(f"Adding {file}")
                    zipf.write(file_path, arcname=file)
                else:
                    print(f"Warning: {file} not found!")

            # Add directories
            for dir_name in include_dirs:
                dir_path = os.path.join(root_dir, dir_name)
                if os.path.exists(dir_path):
                    print(f"Adding {dir_name}/")
                    for root, _, files in os.walk(dir_path):
                        for file in files:
                            file_path = os.path.join(root, file)
                            # Create relative path for archive
                            arcname = os.path.relpath(file_path, root_dir)
                            zipf.write(file_path, arcname=arcname)
                else:
                    print(f"Warning: {dir_name}/ not found!")

        print(f"Successfully created {zip_filename}")

    except Exception as e:
        print(f"Error creating zip file: {e}")

if __name__ == '__main__':
    pack_extension()
